#!/usr/bin/env python3
import argparse
import hashlib
import os
import secrets
import time


def table_for(name):
    try:
        import boto3
    except ImportError as error:
        raise SystemExit("Install boto3 before using this tool: pip install boto3") from error
    return boto3.resource("dynamodb").Table(name)


def create_enrollment(table, label, ttl_seconds):
    code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now = int(time.time())
    table.put_item(
        Item={
            "pk": f"ENROLL#{code_hash}",
            "kind": "enrollment",
            "label": label,
            "created_at": now,
            "expires_at": now + ttl_seconds,
        },
        ConditionExpression="attribute_not_exists(pk)",
    )
    print(f"Device label: {label}")
    print(f"Enrollment code (single use, expires in {ttl_seconds} seconds):")
    print(code)


def list_devices(table):
    response = table.scan()
    items = response.get("Items", [])
    while response.get("LastEvaluatedKey"):
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        items.extend(response.get("Items", []))

    devices = sorted(
        (item for item in items if item.get("kind") == "device"),
        key=lambda item: item.get("label", ""),
    )
    if not devices:
        print("No enrolled devices.")
        return
    for device in devices:
        print(
            f"{device['device_id']}\t{device.get('status', 'unknown')}\t"
            f"{device.get('label', 'Unlabelled device')}"
        )


def set_device_status(table, device_id, status):
    try:
        table.update_item(
            Key={"pk": f"DEVICE#{device_id}"},
            UpdateExpression="SET #status = :status, status_changed_at = :now",
            ConditionExpression="#kind = :kind",
            ExpressionAttributeNames={"#status": "status", "#kind": "kind"},
            ExpressionAttributeValues={
                ":status": status,
                ":now": int(time.time()),
                ":kind": "device",
            },
        )
    except Exception as error:
        error_code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if error_code == "ConditionalCheckFailedException":
            raise SystemExit(f"Device not found: {device_id}") from error
        raise
    print(f"{device_id}: {status}")


def main():
    parser = argparse.ArgumentParser(description="Manage REDCap relay device enrollment")
    parser.add_argument(
        "--table-name",
        default=os.environ.get("DEVICE_AUTH_TABLE"),
        help="DynamoDB table name (or set DEVICE_AUTH_TABLE)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create-enrollment")
    create.add_argument("--label", required=True)
    create.add_argument("--ttl-seconds", type=int, default=900)

    subparsers.add_parser("list")

    revoke = subparsers.add_parser("revoke")
    revoke.add_argument("device_id")

    approve = subparsers.add_parser("approve")
    approve.add_argument("device_id")

    args = parser.parse_args()
    if not args.table_name:
        parser.error("--table-name or DEVICE_AUTH_TABLE is required")
    table = table_for(args.table_name)

    if args.command == "create-enrollment":
        if args.ttl_seconds <= 0:
            parser.error("--ttl-seconds must be positive")
        create_enrollment(table, args.label, args.ttl_seconds)
    elif args.command == "list":
        list_devices(table)
    elif args.command == "revoke":
        set_device_status(table, args.device_id, "revoked")
    elif args.command == "approve":
        set_device_status(table, args.device_id, "approved")


if __name__ == "__main__":
    main()
