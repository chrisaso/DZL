//! Source engine A2S_INFO queries.
//!
//! dayz-ctl shells out to `ping` for latency, which needs ICMP and tells you
//! nothing about the server itself. Querying the game port instead gives real
//! round-trip time *and* authoritative live player counts, which are often
//! fresher than the DZSA master list.

use serde::{Deserialize, Serialize};

const A2S_INFO_HEADER: &[u8] = b"\xFF\xFF\xFF\xFFTSource Engine Query\0";
const RESPONSE_INFO: u8 = 0x49;
const RESPONSE_CHALLENGE: u8 = 0x41;
const MAX_CONCURRENT_QUERIES: usize = 64;
const DEFAULT_TIMEOUT_MS: u64 = 1500;

/// Extra-data flags. The fields they mark are positional, not tagged, so
/// reaching the keywords means stepping over whichever ones precede it.
const EDF_GAME_PORT: u8 = 0x80;
const EDF_STEAM_ID: u8 = 0x10;
const EDF_SPECTATOR: u8 = 0x40;
const EDF_KEYWORDS: u8 = 0x20;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryTarget {
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub ip: String,
    pub port: u16,
    pub online: bool,
    pub ping_ms: Option<u32>,
    pub players: Option<u32>,
    pub max_players: Option<u32>,
    pub queue: Option<u32>,
    pub name: Option<String>,
    pub map: Option<String>,
    pub version: Option<String>,
}

impl QueryResult {
    fn offline(ip: &str, port: u16) -> Self {
        Self {
            ip: ip.to_string(),
            port,
            online: false,
            ping_ms: None,
            players: None,
            max_players: None,
            queue: None,
            name: None,
            map: None,
            version: None,
        }
    }
}

#[derive(Debug, PartialEq, Clone)]
pub(crate) struct A2sInfo {
    pub name: String,
    pub map: String,
    pub players: u32,
    pub max_players: u32,
    pub version: String,
    pub queue: Option<u32>,
}

/// Little-endian cursor that yields `None` instead of panicking on truncated
/// or hostile packets.
struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|b| b[0])
    }

    fn u16(&mut self) -> Option<u16> {
        self.take(2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }

    fn cstring(&mut self) -> Option<String> {
        let start = self.pos;
        let end = self.data[start..].iter().position(|b| *b == 0)? + start;
        let text = String::from_utf8_lossy(&self.data[start..end]).to_string();
        self.pos = end + 1;
        Some(text)
    }
}

/// Reads the keywords tag list out of the optional extra-data block.
///
/// Everything here is best-effort: a server that sends no extra data, omits the
/// keywords flag, or truncates the block costs us the tags and nothing else.
fn read_keywords(r: &mut Reader) -> Option<String> {
    let flags = r.u8()?;
    if flags & EDF_GAME_PORT != 0 {
        r.u16()?;
    }
    if flags & EDF_STEAM_ID != 0 {
        r.take(8)?;
    }
    if flags & EDF_SPECTATOR != 0 {
        r.u16()?;
        r.cstring()?;
    }
    if flags & EDF_KEYWORDS == 0 {
        return None;
    }
    r.cstring()
}

/// DayZ publishes the login queue length among its keywords as `lqs<n>`. It is
/// a Bohemia convention rather than anything Source guarantees, so anything
/// that does not parse cleanly is reported as unknown rather than as zero.
fn parse_queue_tag(keywords: &str) -> Option<u32> {
    keywords
        .split(',')
        .find_map(|tag| tag.strip_prefix("lqs")?.parse().ok())
}

/// Parses an S2A_INFO response body. Returns `None` for anything that is not a
/// well-formed info reply.
pub(crate) fn parse_a2s_info(packet: &[u8]) -> Option<A2sInfo> {
    let mut r = Reader::new(packet);

    if r.take(4)? != [0xFF, 0xFF, 0xFF, 0xFF] {
        return None;
    }
    if r.u8()? != RESPONSE_INFO {
        return None;
    }

    let _protocol = r.u8()?;
    let name = r.cstring()?;
    let map = r.cstring()?;
    let _folder = r.cstring()?;
    let _game = r.cstring()?;
    let _app_id = r.u16()?;
    let players = r.u8()? as u32;
    let max_players = r.u8()? as u32;
    let _bots = r.u8()?;
    let _server_type = r.u8()?;
    let _environment = r.u8()?;
    let _visibility = r.u8()?;
    let _vac = r.u8()?;
    let version = r.cstring()?;
    let queue = read_keywords(&mut r).as_deref().and_then(parse_queue_tag);

    Some(A2sInfo {
        name,
        map,
        players,
        max_players,
        version,
        queue,
    })
}

/// Extracts the 4-byte challenge from an S2A_CHALLENGE reply.
pub(crate) fn parse_challenge(packet: &[u8]) -> Option<[u8; 4]> {
    let mut r = Reader::new(packet);
    if r.take(4)? != [0xFF, 0xFF, 0xFF, 0xFF] {
        return None;
    }
    if r.u8()? != RESPONSE_CHALLENGE {
        return None;
    }
    let bytes = r.take(4)?;
    Some([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// Builds the query datagram, optionally answering a challenge.
pub(crate) fn build_request(challenge: Option<[u8; 4]>) -> Vec<u8> {
    let mut packet = A2S_INFO_HEADER.to_vec();
    if let Some(challenge) = challenge {
        packet.extend_from_slice(&challenge);
    }
    packet
}

async fn query_one(target: &QueryTarget, timeout: std::time::Duration) -> QueryResult {
    let addr = format!("{}:{}", target.ip, target.port);
    let started = std::time::Instant::now();

    let result = tokio::time::timeout(timeout, async {
        let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.ok()?;
        socket.connect(&addr).await.ok()?;
        socket.send(&build_request(None)).await.ok()?;

        let mut buf = vec![0u8; 4096];
        let len = socket.recv(&mut buf).await.ok()?;

        // Modern Source servers answer the first query with a challenge that
        // must be echoed back before they hand over the info payload.
        if let Some(challenge) = parse_challenge(&buf[..len]) {
            socket.send(&build_request(Some(challenge))).await.ok()?;
            let len = socket.recv(&mut buf).await.ok()?;
            return parse_a2s_info(&buf[..len]);
        }

        parse_a2s_info(&buf[..len])
    })
    .await;

    match result {
        Ok(Some(info)) => QueryResult {
            ip: target.ip.clone(),
            port: target.port,
            online: true,
            ping_ms: Some(started.elapsed().as_millis().min(u32::MAX as u128) as u32),
            players: Some(info.players),
            max_players: Some(info.max_players),
            queue: info.queue,
            name: Some(info.name),
            map: Some(info.map),
            version: Some(info.version),
        },
        _ => QueryResult::offline(&target.ip, target.port),
    }
}

/// Queries many servers concurrently. Unreachable servers come back as
/// `online: false` rather than failing the whole batch.
#[tauri::command]
pub async fn query_servers(targets: Vec<QueryTarget>, timeout_ms: Option<u64>) -> Vec<QueryResult> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_QUERIES));

    let handles: Vec<_> = targets
        .into_iter()
        .map(|target| {
            let semaphore = semaphore.clone();
            tokio::spawn(async move {
                let _permit = semaphore.acquire().await;
                query_one(&target, timeout).await
            })
        })
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info_packet() -> Vec<u8> {
        let mut p = vec![0xFF, 0xFF, 0xFF, 0xFF, RESPONSE_INFO];
        p.push(17); // protocol
        p.extend_from_slice(b"Test Server\0");
        p.extend_from_slice(b"chernarusplus\0");
        p.extend_from_slice(b"dayz\0");
        p.extend_from_slice(b"DayZ\0");
        // The A2S id field is 16 bits, so a large app id arrives truncated.
        p.extend_from_slice(&((221100u32 & 0xFFFF) as u16).to_le_bytes());
        p.push(42); // players
        p.push(60); // max players
        p.push(0); // bots
        p.push(b'd'); // server type
        p.push(b'l'); // environment
        p.push(0); // visibility
        p.push(1); // vac
        p.extend_from_slice(b"1.28.159940\0");
        p
    }

    /// A DayZ reply as the servers actually send it: game port, Steam id,
    /// keywords and game id, in the order the extra-data flags demand.
    fn dayz_packet(keywords: &str) -> Vec<u8> {
        let mut p = info_packet();
        p.push(0xB1); // port | steam id | keywords | game id
        p.extend_from_slice(&2302u16.to_le_bytes());
        p.extend_from_slice(&90290043622796314u64.to_le_bytes());
        p.extend_from_slice(keywords.as_bytes());
        p.push(0);
        p.extend_from_slice(&221100u64.to_le_bytes());
        p
    }

    #[test]
    fn parses_a_well_formed_info_response() {
        let info = parse_a2s_info(&info_packet()).unwrap();
        assert_eq!(info.name, "Test Server");
        assert_eq!(info.map, "chernarusplus");
        assert_eq!(info.players, 42);
        assert_eq!(info.max_players, 60);
        assert_eq!(info.version, "1.28.159940");
    }

    /// A reply captured off the wire from a full public server. The synthetic
    /// packets above encode our own reading of the layout; this one holds that
    /// reading against what DayZ actually sends.
    const CAPTURED_REPLY: &str = "ffffffff49115355455441205255207c20335050207c20505650204d4f5245204c4f4f54207c\
        20574950452031382e303700636865726e61727573706c7573006461797a0000000078780064\
        770001312e32392e31363334353100b1fe080c54877c50c64001626174746c6579652c657874\
        65726e616c2c70726976486976652c73686172643132334142432c6c717332382c65746d322e\
        3030303030302c656e746d32342e3030303030302c6d6f642c31363a333000ac5f0300000000\
        00";

    fn decode_hex(hex: &str) -> Vec<u8> {
        let digits: Vec<char> = hex.chars().filter(|c| !c.is_whitespace()).collect();
        digits
            .chunks(2)
            .map(|pair| u8::from_str_radix(&pair.iter().collect::<String>(), 16).unwrap())
            .collect()
    }

    #[test]
    fn parses_a_reply_captured_from_a_live_server() {
        let info = parse_a2s_info(&decode_hex(CAPTURED_REPLY)).unwrap();
        assert_eq!(info.name, "SUETA RU | 3PP | PVP MORE LOOT | WIPE 18.07");
        assert_eq!(info.map, "chernarusplus");
        assert_eq!(info.version, "1.29.163451");
        assert_eq!(info.players, 120);
        assert_eq!(info.max_players, 120);
        assert_eq!(info.queue, Some(28));
    }

    #[test]
    fn reads_the_login_queue_from_the_keywords_tags() {
        let packet = dayz_packet("battleye,external,privHive,lqs17,etm4.000000,mod,08:03");
        assert_eq!(parse_a2s_info(&packet).unwrap().queue, Some(17));
    }

    #[test]
    fn steps_over_the_full_width_of_each_preceding_extra_field() {
        // A Steam id carrying zero bytes. Misjudge its width and the keywords
        // read starts inside it and terminates on the first of those zeros,
        // which silently costs us the tags.
        let mut p = info_packet();
        p.push(0xB1);
        p.extend_from_slice(&2302u16.to_le_bytes());
        p.extend_from_slice(&0x0000_00FF_FFFF_FFFFu64.to_le_bytes());
        p.extend_from_slice(b"battleye,lqs9,mod\0");
        p.extend_from_slice(&221100u64.to_le_bytes());

        assert_eq!(parse_a2s_info(&p).unwrap().queue, Some(9));
    }

    #[test]
    fn an_empty_queue_reads_as_zero_rather_than_unknown() {
        let packet = dayz_packet("battleye,external,lqs0,etm1.000000,mod,14:02");
        assert_eq!(parse_a2s_info(&packet).unwrap().queue, Some(0));
    }

    #[test]
    fn queue_is_unknown_when_the_tags_carry_no_lqs() {
        let packet = dayz_packet("battleye,external,etm4.000000,mod");
        assert_eq!(parse_a2s_info(&packet).unwrap().queue, None);
    }

    #[test]
    fn queue_is_unknown_when_the_server_sends_no_extra_data() {
        assert_eq!(parse_a2s_info(&info_packet()).unwrap().queue, None);
    }

    #[test]
    fn queue_is_unknown_when_the_tags_are_absent_from_the_flags() {
        // Port and game id present, keywords bit clear.
        let mut p = info_packet();
        p.push(0x81);
        p.extend_from_slice(&2302u16.to_le_bytes());
        p.extend_from_slice(&221100u64.to_le_bytes());
        assert_eq!(parse_a2s_info(&p).unwrap().queue, None);
    }

    #[test]
    fn a_malformed_lqs_value_leaves_the_queue_unknown() {
        let packet = dayz_packet("battleye,lqsx,etm4.000000");
        assert_eq!(parse_a2s_info(&packet).unwrap().queue, None);
    }

    #[test]
    fn truncated_extra_data_still_yields_the_base_info() {
        let full = dayz_packet("battleye,lqs9,etm4.000000");
        let base = info_packet().len();
        for cut in base..full.len() {
            let info = parse_a2s_info(&full[..cut])
                .expect("a short extra-data block must not discard the reply");
            assert_eq!(info.players, 42);
        }
    }

    #[test]
    fn rejects_packet_with_wrong_header() {
        let mut packet = info_packet();
        packet[0] = 0x00;
        assert_eq!(parse_a2s_info(&packet), None);
    }

    #[test]
    fn rejects_packet_with_wrong_response_type() {
        let mut packet = info_packet();
        packet[4] = RESPONSE_CHALLENGE;
        assert_eq!(parse_a2s_info(&packet), None);
    }

    #[test]
    fn truncated_packet_returns_none_instead_of_panicking() {
        let packet = info_packet();
        for cut in 0..packet.len() {
            // Any prefix must be handled gracefully.
            let _ = parse_a2s_info(&packet[..cut]);
        }
        assert_eq!(parse_a2s_info(&packet[..12]), None);
    }

    #[test]
    fn unterminated_string_returns_none() {
        let mut p = vec![0xFF, 0xFF, 0xFF, 0xFF, RESPONSE_INFO, 17];
        p.extend_from_slice(b"no terminator here");
        assert_eq!(parse_a2s_info(&p), None);
    }

    #[test]
    fn parses_challenge_response() {
        let packet = [0xFF, 0xFF, 0xFF, 0xFF, RESPONSE_CHALLENGE, 1, 2, 3, 4];
        assert_eq!(parse_challenge(&packet), Some([1, 2, 3, 4]));
    }

    #[test]
    fn info_response_is_not_mistaken_for_a_challenge() {
        assert_eq!(parse_challenge(&info_packet()), None);
    }

    #[test]
    fn truncated_challenge_returns_none() {
        let packet = [0xFF, 0xFF, 0xFF, 0xFF, RESPONSE_CHALLENGE, 1, 2];
        assert_eq!(parse_challenge(&packet), None);
    }

    #[test]
    fn request_appends_challenge_when_present() {
        let plain = build_request(None);
        assert_eq!(plain, A2S_INFO_HEADER.to_vec());

        let answered = build_request(Some([9, 8, 7, 6]));
        assert_eq!(answered.len(), plain.len() + 4);
        assert_eq!(&answered[answered.len() - 4..], &[9, 8, 7, 6]);
    }

    #[tokio::test]
    async fn unreachable_server_reports_offline_without_hanging() {
        // TEST-NET-1 address; guaranteed not to answer.
        let targets = vec![QueryTarget {
            ip: "192.0.2.1".into(),
            port: 27016,
        }];
        let results = query_servers(targets, Some(150)).await;

        assert_eq!(results.len(), 1);
        assert!(!results[0].online);
        assert_eq!(results[0].ping_ms, None);
    }

    #[tokio::test]
    async fn answers_a_real_query_against_a_local_socket() {
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();

        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            // First request gets a challenge...
            let (_, peer) = server.recv_from(&mut buf).unwrap();
            server
                .send_to(
                    &[0xFF, 0xFF, 0xFF, 0xFF, RESPONSE_CHALLENGE, 1, 2, 3, 4],
                    peer,
                )
                .unwrap();
            // ...the echoed challenge gets the real payload.
            let (len, peer) = server.recv_from(&mut buf).unwrap();
            assert_eq!(&buf[len - 4..len], &[1, 2, 3, 4]);
            server.send_to(&info_packet(), peer).unwrap();
        });

        let results = query_servers(
            vec![QueryTarget {
                ip: "127.0.0.1".into(),
                port,
            }],
            Some(3000),
        )
        .await;

        assert!(results[0].online);
        assert_eq!(results[0].players, Some(42));
        assert_eq!(results[0].max_players, Some(60));
        assert_eq!(results[0].name.as_deref(), Some("Test Server"));
        assert!(results[0].ping_ms.is_some());
    }

    #[tokio::test]
    async fn the_queue_reaches_the_query_result() {
        let server = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();

        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let (_, peer) = server.recv_from(&mut buf).unwrap();
            server
                .send_to(&dayz_packet("battleye,external,lqs12,etm4.000000"), peer)
                .unwrap();
        });

        let results = query_servers(
            vec![QueryTarget {
                ip: "127.0.0.1".into(),
                port,
            }],
            Some(3000),
        )
        .await;

        assert_eq!(results[0].queue, Some(12));
    }

    #[test]
    fn an_offline_server_has_no_queue() {
        assert_eq!(QueryResult::offline("192.0.2.1", 27016).queue, None);
    }
}
