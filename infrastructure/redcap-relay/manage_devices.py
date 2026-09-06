#!/usr/bin/env python3
import argparse
import os
import sys
import time
from urllib.parse import urlencode, urlsplit, urlunsplit

from enrollment_code import (
    display_enrollment_code,
    generate_enrollment_code,
    hash_enrollment_code,
)


def table_for(name):
    try:
        import boto3
    except ImportError as error:
        raise SystemExit("Install boto3 before using this tool: pip install boto3") from error
    return boto3.resource("dynamodb").Table(name)


def enrollment_link(page_url, code):
    parsed = urlsplit(page_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("The enrollment page URL must be an absolute HTTPS URL")
    return urlunsplit(parsed._replace(fragment=urlencode({"code": code})))


def prepare_terminal_qr(value):
    try:
        import qrcode
    except ImportError as error:
        raise SystemExit(
            "Install the administrator dependencies to generate QR codes: "
            "python3 -m pip install -r requirements-admin.txt"
        ) from error
    qr = qrcode.QRCode(border=4)
    qr.add_data(value)
    qr.make(fit=True)
    return qr


def print_terminal_qr(qr):
    qr.print_ascii(tty=sys.stdout.isatty())


def create_enrollment(table, label, ttl_seconds, enrollment_page_url=None):
    code = generate_enrollment_code()
    code_hash = hash_enrollment_code(code)
    link = enrollment_link(enrollment_page_url, code) if enrollment_page_url else None
    qr = prepare_terminal_qr(link) if link else None
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
    print(display_enrollment_code(code))
    if qr:
        print(f"Enrollment link: {link}")
        print("Scan this QR code with the data-collection device:")
        print_terminal_qr(qr)
    return code


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
    create.add_argument(
        "--enrollment-page-url",
        default=os.environ.get("DEVICE_ENROLLMENT_PAGE_URL"),
        help=(
            "HTTPS URL of device-enrollment.html (or set DEVICE_ENROLLMENT_PAGE_URL); "
            "prints a locally generated QR code"
        ),
    )

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
        try:
            create_enrollment(
                table,
                args.label,
                args.ttl_seconds,
                args.enrollment_page_url,
            )
        except ValueError as error:
            parser.error(str(error))
    elif args.command == "list":
        list_devices(table)
    elif args.command == "revoke":
        set_device_status(table, args.device_id, "revoked")
    elif args.command == "approve":
        set_device_status(table, args.device_id, "approved")


if __name__ == "__main__":
    main()
