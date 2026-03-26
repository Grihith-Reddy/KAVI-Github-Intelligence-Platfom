import json
import logging
from typing import Any


audit_logger = logging.getLogger("kavi.audit")


def audit_log(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    audit_logger.info(json.dumps(payload, default=str, sort_keys=True))
