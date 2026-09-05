import unittest
from unittest.mock import Mock, patch

import manage_devices


class FakeDynamoDBError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class ManageDevicesTest(unittest.TestCase):
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
