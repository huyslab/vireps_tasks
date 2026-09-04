import base64
import json
import unittest
from unittest.mock import Mock, patch

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

import device_auth


NOW = 1_788_523_200
DEVICE_ID = "12345678-1234-4234-9234-123456789abc"
RECORD_ID = "participant_session"
NONCE = "AAAAAAAAAAAAAAAAAAAAAA"
METHOD_ARN = "arn:aws:execute-api:eu-north-1:123456789012:api/Prod/POST/pharmaciespilot"


class ConditionalFailure(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


def base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def public_jwk(private_key):
    numbers = private_key.public_key().public_numbers()
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": base64url(numbers.x.to_bytes(32, "big")),
        "y": base64url(numbers.y.to_bytes(32, "big")),
    }


def raw_signature(private_key, message):
    der_signature = private_key.sign(message, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_signature)
    return base64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


class DeviceAuthorizationTest(unittest.TestCase):
    def setUp(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.device = {
            "device_id": DEVICE_ID,
            "status": "approved",
            "public_key": json.dumps(public_jwk(self.private_key)),
        }

    def authorizer_event(self, timestamp=NOW, nonce=NONCE, record_id=RECORD_ID):
        message = device_auth.canonical_request(
            DEVICE_ID, record_id, str(timestamp), nonce
        )
        return {
            "type": "REQUEST",
            "methodArn": METHOD_ARN,
            "headers": {
                "X-Device-Id": DEVICE_ID,
                "X-Record-Id": record_id,
                "X-Request-Timestamp": str(timestamp),
                "X-Request-Nonce": nonce,
                "X-Device-Signature": raw_signature(self.private_key, message),
            },
        }

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_accepts_valid_device_signature(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.authorizer_handler(self.authorizer_event(), None)

        self.assertEqual(result["policyDocument"]["Statement"][0]["Effect"], "Allow")
        self.assertEqual(result["context"]["authorized_record_id"], RECORD_ID)
        nonce_item = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(nonce_item["pk"], f"NONCE#{DEVICE_ID}#{NONCE}")

    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_rejects_bad_signature(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}
        event = self.authorizer_event()
        event["headers"]["X-Device-Signature"] = base64url(bytes(64))

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(Exception, "Unauthorized"):
                device_auth.authorizer_handler(event, None)
        table.put_item.assert_not_called()

    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_rejects_revoked_device(self, current_time):
        table = Mock()
        table.get_item.return_value = {
            "Item": {**self.device, "status": "revoked"}
        }

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(Exception, "Unauthorized"):
                device_auth.authorizer_handler(self.authorizer_event(), None)
        table.put_item.assert_not_called()

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_rejects_stale_request(self, current_time):
        table = Mock()
        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(Exception, "Unauthorized"):
                device_auth.authorizer_handler(
                    self.authorizer_event(timestamp=NOW - 301), None
                )
        table.get_item.assert_not_called()

    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_rejects_replayed_nonce(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}
        table.put_item.side_effect = ConditionalFailure()

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(Exception, "Unauthorized"):
                device_auth.authorizer_handler(self.authorizer_event(), None)

    @patch("device_auth.time.time", return_value=NOW)
    def test_enrollment_consumes_code_and_registers_public_key(self, current_time):
        table = Mock()
        table.update_item.return_value = {
            "Attributes": {"label": "Pharmacy tablet 1"}
        }
        event = {
            "body": json.dumps(
                {
                    "enrollment_code": "a-valid-single-use-enrollment-code",
                    "device_id": DEVICE_ID,
                    "public_key": public_jwk(self.private_key),
                }
            )
        }

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.enrollment_handler(event, None)

        self.assertEqual(result["statusCode"], 201)
        registered = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(registered["status"], "approved")
        self.assertEqual(registered["label"], "Pharmacy tablet 1")
        self.assertEqual(json.loads(registered["public_key"])["crv"], "P-256")

    @patch("device_auth.time.time", return_value=NOW)
    def test_enrollment_rejects_used_or_expired_code(self, current_time):
        table = Mock()
        table.update_item.side_effect = ConditionalFailure()
        event = {
            "body": json.dumps(
                {
                    "enrollment_code": "an-expired-single-use-enrollment-code",
                    "device_id": DEVICE_ID,
                    "public_key": public_jwk(self.private_key),
                }
            )
        }

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.enrollment_handler(event, None)

        self.assertEqual(result["statusCode"], 401)
        table.put_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
