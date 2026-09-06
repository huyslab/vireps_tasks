import base64
import binascii
import hashlib
import json
import re
import time
from os import environ

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature


REQUEST_VERSION = "v1"
DEVICE_PREFIX = "DEVICE#"
ENROLLMENT_PREFIX = "ENROLL#"
NONCE_PREFIX = "NONCE#"
STATUS_RECORD_ID = "__device_status__"
DEVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,128}$")


class AuthorizationDenied(Exception):
    """A caller-controlled authorization failure that API Gateway should return as 401."""


def get_table():
    # boto3 is provided by the Lambda runtime. Import lazily so the cryptographic unit
    # tests can run in the repository's lightweight local Python environment.
    import boto3

    return boto3.resource("dynamodb").Table(environ["DEVICE_AUTH_TABLE"])


def api_response(status_code, body):
    return {
        "isBase64Encoded": False,
        "statusCode": status_code,
        "headers": {"Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }


def base64url_decode(value):
    if not isinstance(value, str):
        raise ValueError("Expected a base64url string")
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def validate_public_key(public_key):
    if not isinstance(public_key, dict):
        raise ValueError("Public key must be an object")
    if public_key.get("kty") != "EC" or public_key.get("crv") != "P-256":
        raise ValueError("Only P-256 EC public keys are supported")

    x = base64url_decode(public_key.get("x"))
    y = base64url_decode(public_key.get("y"))
    if len(x) != 32 or len(y) != 32:
        raise ValueError("Invalid P-256 public key coordinates")

    # Constructing the key validates that the coordinates lie on P-256.
    ec.EllipticCurvePublicNumbers(
        int.from_bytes(x, "big"),
        int.from_bytes(y, "big"),
        ec.SECP256R1(),
    ).public_key()
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": public_key["x"],
        "y": public_key["y"],
    }


def is_conditional_failure(error):
    return (
        getattr(error, "response", {}).get("Error", {}).get("Code")
        == "ConditionalCheckFailedException"
    )


def transaction_conditional_failure_index(error):
    response = getattr(error, "response", {})
    if response.get("Error", {}).get("Code") != "TransactionCanceledException":
        return None
    for index, reason in enumerate(response.get("CancellationReasons", [])):
        if reason.get("Code") == "ConditionalCheckFailed":
            return index
    return None


def enrollment_handler(event, context):
    try:
        body = json.loads(event.get("body") or "")
    except (TypeError, json.JSONDecodeError):
        return api_response(400, {"error": "Request body must be valid JSON"})

    if not isinstance(body, dict):
        return api_response(400, {"error": "Request body must be an object"})

    enrollment_code = body.get("enrollment_code")
    device_id = body.get("device_id")
    if not isinstance(enrollment_code, str) or len(enrollment_code) < 20:
        return api_response(400, {"error": "Invalid enrollment code"})
    if not isinstance(device_id, str) or not DEVICE_ID_PATTERN.fullmatch(device_id):
        return api_response(400, {"error": "Invalid device ID"})

    try:
        public_key = validate_public_key(body.get("public_key"))
    except (TypeError, ValueError):
        return api_response(400, {"error": "Invalid device public key"})

    now = int(time.time())
    code_hash = hashlib.sha256(enrollment_code.encode("utf-8")).hexdigest()
    table = get_table()
    enrollment_key = f"{ENROLLMENT_PREFIX}{code_hash}"
    device_key = f"{DEVICE_PREFIX}{device_id}"

    # DynamoDB transactions cannot copy an attribute from the enrollment item into the
    # new device item. Read the human-readable label first; the transaction below still
    # revalidates the code's state and expiry before committing either write.
    enrollment = table.get_item(
        Key={"pk": enrollment_key},
        ConsistentRead=True,
    ).get("Item")
    label = (enrollment or {}).get("label", "Unlabelled device")
    serialized_public_key = json.dumps(public_key, separators=(",", ":"))

    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": table.name,
                        "Key": {"pk": {"S": enrollment_key}},
                        "UpdateExpression": "SET used_at = :now, used_by = :device_id",
                        "ConditionExpression": (
                            "#kind = :kind AND expires_at >= :now "
                            "AND attribute_not_exists(used_at)"
                        ),
                        "ExpressionAttributeNames": {"#kind": "kind"},
                        "ExpressionAttributeValues": {
                            ":kind": {"S": "enrollment"},
                            ":now": {"N": str(now)},
                            ":device_id": {"S": device_id},
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": table.name,
                        "Item": {
                            "pk": {"S": device_key},
                            "kind": {"S": "device"},
                            "device_id": {"S": device_id},
                            "label": {"S": label},
                            "status": {"S": "approved"},
                            "public_key": {"S": serialized_public_key},
                            "enrolled_at": {"N": str(now)},
                        },
                        "ConditionExpression": "attribute_not_exists(pk)",
                    }
                },
            ]
        )
    except Exception as error:
        failed_operation = transaction_conditional_failure_index(error)
        if failed_operation == 0:
            return api_response(401, {"error": "Enrollment code is invalid or expired"})
        if failed_operation == 1:
            return api_response(409, {"error": "Device ID is already registered"})
        raise

    return api_response(
        201,
        {"device_id": device_id, "label": label, "status": "approved"},
    )


def canonical_request(device_id, record_id, timestamp, nonce):
    values = [REQUEST_VERSION, device_id, record_id, str(timestamp), nonce]
    if any("\n" in value or "\r" in value for value in values):
        raise ValueError("Signed values cannot contain newlines")
    return "\n".join(values).encode("utf-8")


def public_key_from_device(device):
    public_key = validate_public_key(json.loads(device["public_key"]))
    x = int.from_bytes(base64url_decode(public_key["x"]), "big")
    y = int.from_bytes(base64url_decode(public_key["y"]), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def verify_signature(public_key, message, encoded_signature):
    raw_signature = base64url_decode(encoded_signature)
    if len(raw_signature) != 64:
        raise ValueError("Invalid P-256 signature length")
    r = int.from_bytes(raw_signature[:32], "big")
    s = int.from_bytes(raw_signature[32:], "big")
    public_key.verify(
        encode_dss_signature(r, s),
        message,
        ec.ECDSA(hashes.SHA256()),
    )


def normalized_headers(event):
    return {
        str(key).lower(): value
        for key, value in (event.get("headers") or {}).items()
    }


def allow_policy(device_id, method_arn, record_id):
    return {
        "principalId": device_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": "Allow",
                    "Resource": method_arn,
                }
            ],
        },
        "context": {
            "device_id": device_id,
            "authorized_record_id": record_id,
        },
    }


def parse_signed_headers(event):
    """Extracts and shape-checks the signed request headers common to both signed routes.

    Every caller-controlled problem becomes the same AuthorizationDenied, so nothing here
    can reveal which credential component was wrong.
    """
    try:
        headers = normalized_headers(event)
        device_id = headers["x-device-id"]
        record_id = headers["x-record-id"]
        timestamp_text = headers["x-request-timestamp"]
        nonce = headers["x-request-nonce"]
        signature = headers["x-device-signature"]

        if not isinstance(device_id, str) or not DEVICE_ID_PATTERN.fullmatch(device_id):
            raise ValueError("Invalid device ID")
        if not isinstance(record_id, str) or not 1 <= len(record_id) <= 256:
            raise ValueError("Invalid record ID")
        if not isinstance(nonce, str) or not NONCE_PATTERN.fullmatch(nonce):
            raise ValueError("Invalid nonce")
        if not isinstance(signature, str):
            raise ValueError("Invalid signature")
        timestamp = int(timestamp_text)
        message = canonical_request(device_id, record_id, timestamp_text, nonce)
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        raise AuthorizationDenied("Malformed request credentials") from error

    return {
        "device_id": device_id,
        "record_id": record_id,
        "timestamp": timestamp,
        "nonce": nonce,
        "signature": signature,
        "message": message,
    }


def request_max_age():
    try:
        max_age = int(environ.get("REQUEST_MAX_AGE_SECONDS", "300"))
    except ValueError as error:
        raise RuntimeError("REQUEST_MAX_AGE_SECONDS must be an integer") from error
    if max_age <= 0:
        raise RuntimeError("REQUEST_MAX_AGE_SECONDS must be positive")
    return max_age


def load_device(table, device_id):
    return table.get_item(
        Key={"pk": f"{DEVICE_PREFIX}{device_id}"},
        ConsistentRead=True,
    ).get("Item")


def authorizer_handler(event, context):
    try:
        request = parse_signed_headers(event)
        try:
            method_arn = event["methodArn"]
        except (KeyError, TypeError) as error:
            raise AuthorizationDenied("Malformed request credentials") from error

        max_age = request_max_age()
        now = int(time.time())
        if abs(now - request["timestamp"]) > max_age:
            raise AuthorizationDenied("Stale request")

        table = get_table()
        device = load_device(table, request["device_id"])
        if not device or device.get("status") != "approved":
            raise AuthorizationDenied("Device is not approved")

        # A malformed stored public key indicates corrupted server-side state, not bad
        # caller credentials, so construct it outside the credential-error conversion.
        public_key = public_key_from_device(device)
        try:
            verify_signature(public_key, request["message"], request["signature"])
        except (binascii.Error, InvalidSignature, TypeError, ValueError) as error:
            raise AuthorizationDenied("Invalid device signature") from error

        try:
            table.put_item(
                Item={
                    "pk": f"{NONCE_PREFIX}{request['device_id']}#{request['nonce']}",
                    "kind": "nonce",
                    "expires_at": now + (max_age * 2),
                },
                ConditionExpression="attribute_not_exists(pk)",
            )
        except Exception as error:
            if is_conditional_failure(error):
                raise AuthorizationDenied("Replayed nonce") from error
            raise
        return allow_policy(request["device_id"], method_arn, request["record_id"])
    except AuthorizationDenied as error:
        # API Gateway converts this exact authorizer error into a 401. Do not expose which
        # credential component failed, and never log signatures or enrollment codes.
        print(f"Device authorization denied: {type(error).__name__}")
        raise Exception("Unauthorized") from None


def status_handler(event, context):
    """Reports *why* a browser may or may not collect data.

    This route deliberately does not sit behind the request authorizer. The authorizer
    answers one question - may this write proceed - and collapses revocation, a missing
    enrollment, a bad signature and a drifted clock into one opaque 401, which is right for
    a write but useless as a governance verdict: the browser uses this answer to decide
    whether to collect at all, and a tablet whose clock has drifted past the freshness
    window must not be told it is unapproved and made to discard the session.

    So it verifies the same signature itself and separates the cases:

      - ``unapproved`` - revoked or unknown to the server. Definitive: no collection.
      - ``clock_skew`` - signature and enrollment are good, only the timestamp is stale.
        The device is approved; ``server_time`` lets it correct itself and carry on.
      - ``approved``   - everything checks out.
      - HTTP 401       - malformed credentials or a signature that does not verify. Still
        undifferentiated, and the browser treats it as "cannot tell" rather than as
        permission to stop collecting.

    ``server_time`` is on every response, including the 401, so a drifted device can
    calibrate from any of them. No nonce is recorded: this is a read-only check that must
    keep working precisely when timestamps are stale, and it discloses nothing beyond the
    status of the device whose signature was just verified.
    """
    now = int(time.time())
    try:
        request = parse_signed_headers(event)
    except AuthorizationDenied:
        print("Device status denied: malformed request credentials")
        return api_response(401, {"error": "Unauthorized", "server_time": now})

    device = load_device(get_table(), request["device_id"])
    if not device:
        return api_response(200, {"status": "unapproved", "server_time": now})

    # A malformed stored public key is corrupted server-side state; let it surface as 5xx
    # rather than becoming a verdict about the device.
    public_key = public_key_from_device(device)
    try:
        verify_signature(public_key, request["message"], request["signature"])
    except (binascii.Error, InvalidSignature, TypeError, ValueError):
        print("Device status denied: invalid device signature")
        return api_response(401, {"error": "Unauthorized", "server_time": now})

    if device.get("status") != "approved":
        return api_response(200, {"status": "unapproved", "server_time": now})

    if abs(now - request["timestamp"]) > request_max_age():
        return api_response(200, {"status": "clock_skew", "server_time": now})

    return api_response(
        200,
        {
            "status": "approved",
            "device_id": request["device_id"],
            "server_time": now,
        },
    )
