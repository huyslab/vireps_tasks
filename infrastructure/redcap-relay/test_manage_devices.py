import unittest
from unittest.mock import Mock, patch

import manage_devices


class FakeDynamoDBError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class ManageDevicesTest(unittest.TestCase):
    @patch("manage_devices.print_terminal_qr")
    @patch("manage_devices.generate_enrollment_code", return_value="7K3MP9XRD2HF")
    @patch("manage_devices.time.time", return_value=1788624000)
    @patch("builtins.print")
    def test_create_enrollment_prints_short_code_and_local_qr(
        self, output, current_time, generate_code, print_qr
    ):
        table = Mock()
        page_url = "https://tasks.example/device-enrollment.html"

        code = manage_devices.create_enrollment(
            table, "Pharmacy tablet 1", 900, page_url
        )

        self.assertEqual(code, "7K3MP9XRD2HF")
        stored = table.put_item.call_args.kwargs["Item"]
        self.assertEqual(stored["label"], "Pharmacy tablet 1")
        self.assertEqual(stored["created_at"], 1788624000)
        self.assertEqual(stored["expires_at"], 1788624900)
        self.assertTrue(stored["pk"].startswith("ENROLL#"))
        output.assert_any_call("7K3M-P9XR-D2HF")
        link = f"{page_url}#code=7K3MP9XRD2HF"
        output.assert_any_call(f"Enrollment link: {link}")
        print_qr.assert_called_once_with(link)
        generate_code.assert_called_once_with()
        current_time.assert_called_once_with()

    def test_enrollment_link_requires_https_before_storing_code(self):
        table = Mock()

        with self.assertRaisesRegex(ValueError, "absolute HTTPS URL"):
            manage_devices.create_enrollment(
                table,
                "Pharmacy tablet 1",
                900,
                "http://tasks.example/device-enrollment.html",
            )

        table.put_item.assert_not_called()

    @patch("manage_devices.time.time", return_value=1788624000)
    @patch("builtins.print")
    def test_set_device_status_updates_an_existing_device(self, output, current_time):
        table = Mock()

        manage_devices.set_device_status(table, "tablet-1", "revoked")

        table.update_item.assert_called_once_with(
            Key={"pk": "DEVICE#tablet-1"},
            UpdateExpression="SET #status = :status, status_changed_at = :now",
            ConditionExpression="#kind = :kind",
            ExpressionAttributeNames={"#status": "status", "#kind": "kind"},
            ExpressionAttributeValues={
                ":status": "revoked",
                ":now": 1788624000,
                ":kind": "device",
            },
        )
        output.assert_called_once_with("tablet-1: revoked")
        current_time.assert_called_once_with()

    def test_set_device_status_reports_a_missing_device(self):
        table = Mock()
        table.update_item.side_effect = FakeDynamoDBError(
            "ConditionalCheckFailedException"
        )

        with self.assertRaisesRegex(SystemExit, "Device not found: tablet-typo"):
            manage_devices.set_device_status(table, "tablet-typo", "revoked")

    def test_set_device_status_does_not_hide_operational_failures(self):
        table = Mock()
        service_error = FakeDynamoDBError("ProvisionedThroughputExceededException")
        table.update_item.side_effect = service_error

        with self.assertRaises(FakeDynamoDBError) as raised:
            manage_devices.set_device_status(table, "tablet-1", "approved")

        self.assertIs(raised.exception, service_error)


if __name__ == "__main__":
    unittest.main()
