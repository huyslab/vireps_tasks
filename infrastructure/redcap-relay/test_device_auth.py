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
METHOD_ARN = "arn:aws:execute-api:eu-north-1:123456789012:api/Prod/POST/redcap"


class ConditionalFailure(Exception):
    response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class TransactionFailure(Exception):
    def __init__(self, failed_operation):
        reasons = [{"Code": "None"}, {"Code": "None"}]
        reasons[failed_operation] = {"Code": "ConditionalCheckFailed"}
        self.response = {
            "Error": {"Code": "TransactionCanceledException"},
            "CancellationReasons": reasons,
        }


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
    def test_authorizer_surfaces_dynamodb_read_failure(self, current_time):
        table = Mock()
        table.get_item.side_effect = RuntimeError("DynamoDB unavailable")

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(RuntimeError, "DynamoDB unavailable"):
                device_auth.authorizer_handler(self.authorizer_event(), None)

    @patch("device_auth.time.time", return_value=NOW)
    def test_authorizer_surfaces_dynamodb_nonce_write_failure(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}
        table.put_item.side_effect = RuntimeError("DynamoDB unavailable")

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(RuntimeError, "DynamoDB unavailable"):
                device_auth.authorizer_handler(self.authorizer_event(), None)

    def status_event(self, timestamp=NOW, device_id=DEVICE_ID):
        message = device_auth.canonical_request(
            device_id, device_auth.STATUS_RECORD_ID, str(timestamp), NONCE
        )
        return {
            "headers": {
                "X-Device-Id": device_id,
                "X-Record-Id": device_auth.STATUS_RECORD_ID,
                "X-Request-Timestamp": str(timestamp),
                "X-Request-Nonce": NONCE,
                "X-Device-Signature": raw_signature(self.private_key, message),
            }
        }

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_approves_a_fresh_signed_request(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(self.status_event(), None)

        self.assertEqual(result["statusCode"], 200)
        body = json.loads(result["body"])
        self.assertEqual(body["status"], "approved")
        self.assertEqual(body["server_time"], NOW)
        # A read-only check must not consume the device's replay protection.
        table.put_item.assert_not_called()

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_reports_clock_skew_rather_than_denial(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}

        # An hour of drift is what the authorizer collapses into an opaque 401. Here the
        # signature and the enrollment still verify, so the device is approved and only its
        # clock is wrong - and server_time is what lets it correct itself and keep
        # collecting instead of being sent to demo mode.
        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(self.status_event(timestamp=NOW - 3600), None)

        self.assertEqual(result["statusCode"], 200)
        body = json.loads(result["body"])
        self.assertEqual(body["status"], "clock_skew")
        self.assertEqual(body["server_time"], NOW)

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_reports_a_revoked_device_as_unapproved(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": {**self.device, "status": "revoked"}}

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(self.status_event(), None)

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["status"], "unapproved")

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_reports_an_unknown_device_as_unapproved(self, current_time):
        table = Mock()
        table.get_item.return_value = {}

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(self.status_event(), None)

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["status"], "unapproved")

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_rejects_an_unverifiable_signature_without_a_verdict(self, current_time):
        table = Mock()
        table.get_item.return_value = {"Item": self.device}
        event = self.status_event()
        event["headers"]["X-Device-Signature"] = base64url(bytes(64))

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(event, None)

        # No "status" field: the browser must not read this as permission to stop
        # collecting, only as "cannot tell".
        self.assertEqual(result["statusCode"], 401)
        body = json.loads(result["body"])
        self.assertNotIn("status", body)
        self.assertEqual(body["server_time"], NOW)

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_rejects_malformed_credentials_before_reading_the_table(self, current_time):
        table = Mock()
        event = self.status_event()
        del event["headers"]["X-Device-Signature"]

        with patch("device_auth.get_table", return_value=table):
            result = device_auth.status_handler(event, None)

        self.assertEqual(result["statusCode"], 401)
        self.assertNotIn("status", json.loads(result["body"]))
        table.get_item.assert_not_called()

    @patch.dict("os.environ", {"REQUEST_MAX_AGE_SECONDS": "300"})
    @patch("device_auth.time.time", return_value=NOW)
    def test_status_surfaces_dynamodb_failure_rather_than_denying(self, current_time):
        table = Mock()
        table.get_item.side_effect = RuntimeError("DynamoDB unavailable")

        with patch("device_auth.get_table", return_value=table):
            with self.assertRaisesRegex(RuntimeError, "DynamoDB unavailable"):
                device_auth.status_handler(self.status_event(), None)

    @patch("device_auth.time.time", return_value=NOW)
    def test_enrollment_consumes_code_and_registers_public_key(self, current_time):
        table = Mock()
        table.name = "DeviceAuthTable"
        table.get_item.return_value = {
            "Item": {"kind": "enrollment", "label": "Pharmacy tablet 1"}
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
        transaction = table.meta.client.transact_write_items.call_args.kwargs
        self.assertEqual(len(transaction["TransactItems"]), 2)
        registered = transaction["TransactItems"][1]["Put"]["Item"]
        self.assertEqual(registered["status"], {"S": "approved"})
        self.assertEqual(registered["label"], {"S": "Pharmacy tablet 1"})
        self.assertEqual(json.loads(registered["public_key"]["S"])["crv"], "P-256")
        table.update_item.assert_not_called()
        table.put_item.assert_not_called()

    @patch("device_auth.time.time", return_value=NOW)
    def test_enrollment_rejects_used_or_expired_code(self, current_time):
        table = Mock()
        table.name = "DeviceAuthTable"
        table.meta.client.transact_write_items.side_effect = TransactionFailure(0)
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
        table.update_item.assert_not_called()
        table.put_item.assert_not_called()

    @patch("device_auth.time.time", return_value=NOW)
    def test_enrollment_device_conflict_rolls_back_code_claim(self, current_time):
        table = Mock()
        table.name = "DeviceAuthTable"
        table.get_item.return_value = {
            "Item": {"kind": "enrollment", "label": "Pharmacy tablet 1"}
        }
        table.meta.client.transact_write_items.side_effect = TransactionFailure(1)
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

        self.assertEqual(result["statusCode"], 409)
        table.meta.client.transact_write_items.assert_called_once()
        table.update_item.assert_not_called()
        table.put_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
