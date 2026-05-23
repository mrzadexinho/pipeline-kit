"""pkit_wire — Python parity helpers for the pipeline-kit wire protocol.

Exports the 5 kit-binding primitives:
  decode_result   ADR IX-3 Result discriminator (namedtuple shape)
  canonical_json  RFC 8785 deterministic JSON bytes
  validate_timestamp  RFC 3339 millisecond-precision validator
  ndjson          Async NDJSON frame reader/writer helpers
  lsp_frame       LSP Content-Length async frame parser
"""

from .decode_result import Ok, Err, decode_result
from .canonical_json import canonical_json
from .timestamp import validate_timestamp

__all__ = [
    "Ok",
    "Err",
    "decode_result",
    "canonical_json",
    "validate_timestamp",
]
