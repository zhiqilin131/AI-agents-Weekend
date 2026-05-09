import csv
import os
import secrets
import string
import sys
import time

from supabase import create_client

SUPA = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


def gen_password(n: int = 16) -> str:
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(chars) for _ in range(n))


def is_already_exists_error(error: Exception) -> bool:
    msg = str(error).lower()
    return "already" in msg or "duplicate" in msg


def create_user(email: str, password: str) -> None:
    SUPA.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
        }
    )


testers = [
    "tester1@foresight-x.local",
    "tester2@foresight-x.local",
    "tester3@foresight-x.local",
    "tester4@foresight-x.local",
    "tester5@foresight-x.local",
]

results = []
created = 0
already_existed = 0
failed = 0
for email in testers:
    password = gen_password()
    try:
        create_user(email, password)
        results.append({"email": email, "password": password, "status": "created"})
        created += 1
        print(f"created {email}")
    except Exception as e:
        if is_already_exists_error(e):
            results.append(
                {
                    "email": email,
                    "password": "(already exists, set a new one if needed)",
                    "status": "exists",
                }
            )
            already_existed += 1
            print(f"exists {email}")
        else:
            print(f"error {email}: {e}; retrying in 2s")
            time.sleep(2)
            try:
                create_user(email, password)
                results.append({"email": email, "password": password, "status": "created"})
                created += 1
                print(f"created {email}")
            except Exception as retry_error:
                if is_already_exists_error(retry_error):
                    results.append(
                        {
                            "email": email,
                            "password": "(already exists, set a new one if needed)",
                            "status": "exists",
                        }
                    )
                    already_existed += 1
                    print(f"exists {email}")
                else:
                    results.append({"email": email, "password": "", "status": f"error: {retry_error}"})
                    failed += 1
                    print(f"error {email}: {retry_error}")

with open("testers.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["email", "password", "status"])
    w.writeheader()
    w.writerows(results)

print("Wrote testers.csv. DO NOT COMMIT THIS FILE.")
print("Send each password to the corresponding tester via private channel.")
print(f"Created: {created}, Already existed: {already_existed}, Failed: {failed}")

if failed > 0:
    sys.exit(1)
