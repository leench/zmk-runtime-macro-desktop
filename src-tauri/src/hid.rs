use std::ffi::CString;
use std::fmt;
use std::io::ErrorKind;
use std::time::Duration;

use hidapi::{DeviceInfo as HidDeviceInfo, HidApi, HidDevice, HidError};

use crate::client::Transport;
use crate::error::TransportError;
use crate::protocol::{Frame, FRAME_SIZE};

pub const RUNTIME_MACRO_USAGE_PAGE: u16 = 0xff60;
pub const RUNTIME_MACRO_USAGE: u16 = 0x61;
pub const REPORT_ID: u8 = 0;
pub const REPORT_SIZE: usize = FRAME_SIZE + 1;

/// A safe, displayable summary of an enumerated HID device.
///
/// The device path and serial number are intentionally not retained in this
/// public summary. A path is kept only inside [`DeviceRecord`] for the current
/// process to open the selected interface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceSummary {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
}

/// An enumerated device with its path kept private for an in-process open.
///
/// `Debug` deliberately prints only the safe summary and never the path.
#[derive(Clone, PartialEq, Eq)]
pub struct DeviceRecord {
    path: Vec<u8>,
    summary: DeviceSummary,
}

impl DeviceRecord {
    pub fn summary(&self) -> DeviceSummary {
        self.summary.clone()
    }

    fn path(&self) -> &[u8] {
        &self.path
    }

    fn has_target_usage(&self) -> bool {
        self.summary.usage_page == RUNTIME_MACRO_USAGE_PAGE
            && self.summary.usage == RUNTIME_MACRO_USAGE
    }

    fn has_missing_usage(&self) -> bool {
        self.summary.usage_page == 0 && self.summary.usage == 0
    }
}

impl fmt::Debug for DeviceRecord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceRecord")
            .field("summary", &self.summary)
            .finish()
    }
}

/// Optional filters for safe runtime macro HID discovery.
///
/// `path` contains an exact path supplied by the current process. It is never
/// included in [`DeviceSummary`] or in discovery error messages.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct DeviceFilter {
    pub path: Option<Vec<u8>>,
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
}

impl fmt::Debug for DeviceFilter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceFilter")
            .field("has_exact_path", &self.path.is_some())
            .field("vendor_id", &self.vendor_id)
            .field("product_id", &self.product_id)
            .finish()
    }
}

/// Discovery/open failures are intentionally coarse where hidapi does not
/// expose a reliable structured reason. In particular, raw backend messages
/// are not copied into errors because they can contain a device path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceDiscoveryError {
    HidApiInitialization,
    NoDevice,
    UsageMetadataMissing,
    AmbiguousDevices { count: usize },
    OpenFailed,
    InvalidPath,
}

impl fmt::Display for DeviceDiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HidApiInitialization => write!(formatter, "could not initialize HID backend"),
            Self::NoDevice => write!(formatter, "no compatible Runtime Macro HID device found"),
            Self::UsageMetadataMissing => write!(
                formatter,
                "HID Usage metadata is unavailable; select a device by exact path"
            ),
            Self::AmbiguousDevices { count } => write!(
                formatter,
                "found {count} compatible Runtime Macro HID devices; select one explicitly"
            ),
            Self::OpenFailed => write!(formatter, "could not open the selected HID device"),
            Self::InvalidPath => write!(formatter, "selected HID path is invalid"),
        }
    }
}

impl std::error::Error for DeviceDiscoveryError {}

/// Enumerate records from a hidapi context without printing or exposing paths.
pub fn enumerate_devices(api: &HidApi) -> Vec<DeviceRecord> {
    api.device_list().map(record_from_hid_info).collect()
}

fn record_from_hid_info(info: &HidDeviceInfo) -> DeviceRecord {
    DeviceRecord {
        path: info.path().to_bytes().to_vec(),
        summary: DeviceSummary {
            vendor_id: info.vendor_id(),
            product_id: info.product_id(),
            product_name: info.product_string().map(ToOwned::to_owned),
            interface_number: info.interface_number(),
            usage_page: info.usage_page(),
            usage: info.usage(),
        },
    }
}

/// Select exactly one runtime macro HID interface record.
///
/// Automatic selection accepts only the exact vendor Usage Page/Usage pair. If
/// no exact match exists and a filtered record has both Usage fields missing,
/// the caller must provide an exact path rather than guessing. An explicit
/// path may select the 0/0 metadata fallback, but still rejects known, other
/// Usage values.
pub fn select_device<'a>(
    records: &'a [DeviceRecord],
    filter: &DeviceFilter,
) -> Result<&'a DeviceRecord, DeviceDiscoveryError> {
    let filtered: Vec<&DeviceRecord> = records
        .iter()
        .filter(|record| {
            filter
                .vendor_id
                .is_none_or(|vendor_id| record.summary.vendor_id == vendor_id)
                && filter
                    .product_id
                    .is_none_or(|product_id| record.summary.product_id == product_id)
                && filter
                    .path
                    .as_deref()
                    .is_none_or(|path| record.path() == path)
        })
        .collect();

    if filter.path.is_some() {
        let usable: Vec<&DeviceRecord> = filtered
            .into_iter()
            .filter(|record| record.has_target_usage() || record.has_missing_usage())
            .collect();
        return select_one(usable);
    }

    let exact: Vec<&DeviceRecord> = filtered
        .iter()
        .copied()
        .filter(|record| record.has_target_usage())
        .collect();
    if !exact.is_empty() {
        return select_one(exact);
    }

    if filtered.iter().any(|record| record.has_missing_usage()) {
        return Err(DeviceDiscoveryError::UsageMetadataMissing);
    }

    Err(DeviceDiscoveryError::NoDevice)
}

fn select_one(records: Vec<&DeviceRecord>) -> Result<&DeviceRecord, DeviceDiscoveryError> {
    match records.as_slice() {
        [] => Err(DeviceDiscoveryError::NoDevice),
        [record] => Ok(record),
        records => Err(DeviceDiscoveryError::AmbiguousDevices {
            count: records.len(),
        }),
    }
}

/// Convert an enumerated record into a live transport.
///
/// The path is used only for this in-process open. hidapi does not provide a
/// stable structured permission/busy error across all supported backends, so
/// backend failures are deliberately mapped to the safe `OpenFailed` variant.
pub fn open_device(
    api: &HidApi,
    record: &DeviceRecord,
) -> Result<HidTransport, DeviceDiscoveryError> {
    let path = CString::new(record.path()).map_err(|_| DeviceDiscoveryError::InvalidPath)?;
    let device = api
        .open_path(path.as_c_str())
        .map_err(|_| DeviceDiscoveryError::OpenFailed)?;
    Ok(HidTransport::new(device))
}

/// Initialize the hidapi context with a safe, displayable error.
pub fn new_hid_api() -> Result<HidApi, DeviceDiscoveryError> {
    HidApi::new().map_err(|_| DeviceDiscoveryError::HidApiInitialization)
}

/// Enumerate, select, and open one device. The returned summary excludes path
/// and serial data; the hidapi context may be dropped after the open succeeds.
pub fn open_selected(
    filter: &DeviceFilter,
) -> Result<(DeviceSummary, HidTransport), DeviceDiscoveryError> {
    let api = new_hid_api()?;
    let records = enumerate_devices(&api);
    let record = select_device(&records, filter)?;
    let summary = record.summary();
    let transport = open_device(&api, record)?;
    Ok((summary, transport))
}

/// Injectable HID operations used by [`HidTransport`]. The production
/// implementation delegates directly to hidapi; tests use a fake without USB.
trait HidIo: Send {
    fn write(&self, data: &[u8]) -> Result<usize, HidError>;
    fn read_timeout(&self, data: &mut [u8], timeout_ms: i32) -> Result<usize, HidError>;
}

impl HidIo for HidDevice {
    fn write(&self, data: &[u8]) -> Result<usize, HidError> {
        HidDevice::write(self, data)
    }

    fn read_timeout(&self, data: &mut [u8], timeout_ms: i32) -> Result<usize, HidError> {
        HidDevice::read_timeout(self, data, timeout_ms)
    }
}

/// A real HIDAPI transport implementing the protocol client's transport trait.
pub struct HidTransport {
    device: Box<dyn HidIo>,
}

impl HidTransport {
    pub fn new(device: HidDevice) -> Self {
        Self {
            device: Box::new(device),
        }
    }

    #[cfg(test)]
    fn from_io(device: Box<dyn HidIo>) -> Self {
        Self { device }
    }

    /// Convert a positive duration to the non-negative i32 millisecond range
    /// accepted by hidapi. Sub-millisecond durations are handled as an
    /// immediate timeout instead of being rounded up past the caller's
    /// deadline.
    fn duration_to_millis(timeout: Duration) -> Option<i32> {
        let millis = timeout.as_millis();
        if millis == 0 {
            None
        } else {
            Some(millis.min(i32::MAX as u128) as i32)
        }
    }

    fn map_hid_error(operation: &'static str, error: HidError) -> TransportError {
        match error {
            HidError::IoError { error }
                if matches!(
                    error.kind(),
                    ErrorKind::Interrupted | ErrorKind::WouldBlock | ErrorKind::TimedOut
                ) =>
            {
                TransportError::Recoverable(format!("HID {operation} was interrupted"))
            }
            _ => TransportError::Fatal(format!("HID {operation} failed")),
        }
    }
}

impl Transport for HidTransport {
    fn write_frame(&mut self, frame: &Frame) -> Result<(), TransportError> {
        let mut report = [0u8; REPORT_SIZE];
        report[0] = REPORT_ID;
        report[1..].copy_from_slice(frame);

        let written = self
            .device
            .write(&report)
            .map_err(|error| Self::map_hid_error("write", error))?;
        if written != REPORT_SIZE {
            return Err(TransportError::Fatal(format!(
                "HID write was partial ({written} of {REPORT_SIZE} bytes)"
            )));
        }
        Ok(())
    }

    fn read_frame(&mut self, timeout: Duration) -> Result<Vec<u8>, TransportError> {
        let timeout_ms = Self::duration_to_millis(timeout).ok_or(TransportError::Timeout)?;
        let mut report = [0u8; REPORT_SIZE];
        let read = self
            .device
            .read_timeout(&mut report, timeout_ms)
            .map_err(|error| Self::map_hid_error("read", error))?;
        if read == 0 {
            return Err(TransportError::Timeout);
        }
        if read > report.len() {
            return Err(TransportError::Fatal(
                "HID read returned more bytes than the supplied buffer".to_string(),
            ));
        }
        Ok(report[..read].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::normalize_response;
    use std::collections::VecDeque;
    use std::io;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct FakeState {
        writes: Vec<Vec<u8>>,
        read_timeouts: Vec<i32>,
        write_result: Option<Result<usize, HidError>>,
        reads: VecDeque<Result<Vec<u8>, HidError>>,
    }

    struct FakeIo {
        state: Arc<Mutex<FakeState>>,
    }

    impl HidIo for FakeIo {
        fn write(&self, data: &[u8]) -> Result<usize, HidError> {
            let mut state = self.state.lock().unwrap();
            state.writes.push(data.to_vec());
            state.write_result.take().unwrap_or(Ok(data.len()))
        }

        fn read_timeout(&self, data: &mut [u8], timeout_ms: i32) -> Result<usize, HidError> {
            let mut state = self.state.lock().unwrap();
            state.read_timeouts.push(timeout_ms);
            let bytes = state.reads.pop_front().unwrap_or(Ok(Vec::new()))?;
            if bytes.len() > data.len() {
                return Ok(bytes.len());
            }
            data[..bytes.len()].copy_from_slice(&bytes);
            Ok(bytes.len())
        }
    }

    fn transport_with_state(state: Arc<Mutex<FakeState>>) -> HidTransport {
        HidTransport::from_io(Box::new(FakeIo { state }))
    }

    fn fake_record(
        path: &[u8],
        vendor_id: u16,
        product_id: u16,
        usage_page: u16,
        usage: u16,
    ) -> DeviceRecord {
        fake_record_with_interface(path, vendor_id, product_id, usage_page, usage, 7)
    }

    fn fake_record_with_interface(
        path: &[u8],
        vendor_id: u16,
        product_id: u16,
        usage_page: u16,
        usage: u16,
        interface_number: i32,
    ) -> DeviceRecord {
        DeviceRecord {
            path: path.to_vec(),
            summary: DeviceSummary {
                vendor_id,
                product_id,
                product_name: Some("Example Keyboard".to_string()),
                interface_number,
                usage_page,
                usage,
            },
        }
    }

    #[test]
    fn discovery_requires_exact_usage_and_does_not_hardcode_interface() {
        let records = vec![
            fake_record(b"wrong-page", 0x1234, 0x5678, 0xff5f, 0x61),
            fake_record(b"wrong-usage", 0x1234, 0x5678, 0xff60, 0x60),
            fake_record(
                b"target",
                0x1234,
                0x5678,
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
            ),
        ];
        let selected = select_device(&records, &DeviceFilter::default()).unwrap();
        assert_eq!(selected.summary().interface_number, 7);
        assert_eq!(
            selected.summary().product_name.as_deref(),
            Some("Example Keyboard")
        );
    }

    #[test]
    fn discovery_distinguishes_no_device_multiple_and_missing_usage() {
        assert_eq!(
            select_device(&[], &DeviceFilter::default()),
            Err(DeviceDiscoveryError::NoDevice)
        );

        let multiple = vec![
            fake_record_with_interface(
                b"target-a",
                0x1234,
                0x5678,
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                1,
            ),
            fake_record_with_interface(
                b"target-b",
                0x1234,
                0x5678,
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                2,
            ),
        ];
        assert_ne!(
            multiple[0].summary().interface_number,
            multiple[1].summary().interface_number
        );
        assert_eq!(
            select_device(&multiple, &DeviceFilter::default()),
            Err(DeviceDiscoveryError::AmbiguousDevices { count: 2 })
        );

        let missing = vec![fake_record(b"unknown", 0x1234, 0x5678, 0, 0)];
        assert_eq!(
            select_device(&missing, &DeviceFilter::default()),
            Err(DeviceDiscoveryError::UsageMetadataMissing)
        );
    }

    #[test]
    fn discovery_applies_vid_pid_and_exact_non_utf8_path_filters() {
        let records = vec![
            fake_record(
                b"other",
                0x1111,
                0x5678,
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
            ),
            fake_record(&[b'e', 0xff, b'x'], 0x1234, 0x5678, 0, 0),
        ];
        let filter = DeviceFilter {
            path: Some(vec![b'e', 0xff, b'x']),
            vendor_id: Some(0x1234),
            product_id: Some(0x5678),
        };
        let selected = select_device(&records, &filter).unwrap();
        assert_eq!(selected.summary().vendor_id, 0x1234);

        let wrong_path = DeviceFilter {
            path: Some(b"other".to_vec()),
            vendor_id: Some(0x1234),
            product_id: Some(0x5678),
        };
        assert_eq!(
            select_device(&records, &wrong_path),
            Err(DeviceDiscoveryError::NoDevice)
        );
    }

    #[test]
    fn explicit_path_allows_missing_usage_but_known_wrong_usage_is_rejected() {
        let missing = vec![fake_record(b"selected", 0x1234, 0x5678, 0, 0)];
        let filter = DeviceFilter {
            path: Some(b"selected".to_vec()),
            ..DeviceFilter::default()
        };
        assert!(select_device(&missing, &filter).is_ok());

        let known_wrong = vec![fake_record(b"selected", 0x1234, 0x5678, 0xff60, 0x62)];
        assert_eq!(
            select_device(&known_wrong, &filter),
            Err(DeviceDiscoveryError::NoDevice)
        );
    }

    #[test]
    fn record_and_filter_debug_omit_private_path() {
        let record = fake_record(b"example-private-path", 0x1234, 0x5678, 0, 0);
        let debug = format!("{record:?}");
        assert!(!debug.contains("example-private-path"));
        assert!(debug.contains("vendor_id"));

        let filter = DeviceFilter {
            path: Some(b"example-private-path".to_vec()),
            ..DeviceFilter::default()
        };
        let filter_debug = format!("{filter:?}");
        assert!(!filter_debug.contains("example-private-path"));
        assert!(filter_debug.contains("has_exact_path"));
    }

    #[test]
    fn write_prepends_zero_report_id_and_rejects_partial_write() {
        let state = Arc::new(Mutex::new(FakeState::default()));
        let mut transport = transport_with_state(Arc::clone(&state));
        let frame = [0xa5u8; FRAME_SIZE];
        transport.write_frame(&frame).unwrap();
        let writes = &state.lock().unwrap().writes;
        let expected = [vec![0], vec![0xa5; FRAME_SIZE]].concat();
        assert_eq!(writes, &vec![expected]);

        let state = Arc::new(Mutex::new(FakeState {
            write_result: Some(Ok(REPORT_SIZE - 1)),
            ..FakeState::default()
        }));
        let mut transport = transport_with_state(state);
        assert!(matches!(
            transport.write_frame(&frame),
            Err(TransportError::Fatal(message)) if message.contains("partial")
        ));
    }

    #[test]
    fn read_preserves_32_or_33_bytes_and_leaves_report_validation_to_protocol() {
        for bytes in [vec![0x11; FRAME_SIZE], vec![0; REPORT_SIZE]] {
            let state = Arc::new(Mutex::new(FakeState {
                reads: VecDeque::from([Ok(bytes.clone())]),
                ..FakeState::default()
            }));
            let mut transport = transport_with_state(state);
            assert_eq!(
                transport.read_frame(Duration::from_millis(7)).unwrap(),
                bytes
            );
        }

        let state = Arc::new(Mutex::new(FakeState {
            reads: VecDeque::from([Ok(vec![1; REPORT_SIZE])]),
            ..FakeState::default()
        }));
        let mut transport = transport_with_state(state);
        let raw = transport.read_frame(Duration::from_millis(7)).unwrap();
        assert_eq!(
            normalize_response(&raw),
            Err(crate::error::ProtocolError::NonZeroReportId(1))
        );
    }

    #[test]
    fn read_zero_maps_to_timeout_and_duration_is_bounded_without_rounding_up() {
        let state = Arc::new(Mutex::new(FakeState::default()));
        let mut transport = transport_with_state(Arc::clone(&state));
        assert_eq!(
            transport.read_frame(Duration::from_nanos(999_999)),
            Err(TransportError::Timeout)
        );
        assert!(state.lock().unwrap().read_timeouts.is_empty());

        let state = Arc::new(Mutex::new(FakeState {
            reads: VecDeque::from([Ok(Vec::new())]),
            ..FakeState::default()
        }));
        let mut transport = transport_with_state(Arc::clone(&state));
        assert_eq!(
            transport.read_frame(Duration::from_millis(i32::MAX as u64 + 1)),
            Err(TransportError::Timeout)
        );
        assert_eq!(state.lock().unwrap().read_timeouts, vec![i32::MAX]);
    }

    #[test]
    fn backend_errors_are_mapped_without_leaking_backend_text() {
        let state = Arc::new(Mutex::new(FakeState {
            reads: VecDeque::from([Err(HidError::IoError {
                error: io::Error::new(ErrorKind::Interrupted, "example backend detail"),
            })]),
            ..FakeState::default()
        }));
        let mut transport = transport_with_state(state);
        assert!(matches!(
            transport.read_frame(Duration::from_millis(1)),
            Err(TransportError::Recoverable(message)) if message == "HID read was interrupted"
        ));

        let state = Arc::new(Mutex::new(FakeState {
            write_result: Some(Err(HidError::HidApiError {
                message: "example backend detail".to_string(),
            })),
            ..FakeState::default()
        }));
        let mut transport = transport_with_state(state);
        let error = transport.write_frame(&[0; FRAME_SIZE]).unwrap_err();
        assert!(matches!(error, TransportError::Fatal(message) if message == "HID write failed"));
    }
}
