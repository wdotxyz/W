"""Backend regression tests for the Change Password flow (iteration 11).

Covers:
- POST /api/auth/login still works for the seeded user
- POST /api/auth/set-password with wrong current_password -> 401
- POST /api/auth/set-password happy path -> 200, login works with new pw
- Reset password back to original so future agents/users can sign in.
- POST /api/support/contact still works (regression)
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://message-hub-1215.preview.emergentagent.com").rstrip("/")
EMAIL = "peter@w.xyz"
ORIG_PW = "PeterW2026!"
TEMP_PW = "PeterW2026!!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    return session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})


def _set_pw(session, token, current_pw, new_pw):
    return session.post(
        f"{BASE_URL}/api/auth/set-password",
        json={"current_password": current_pw, "password": new_pw},
        headers={"Authorization": f"Bearer {token}"},
    )


# --- Login regression ---------------------------------------------------------
def test_login_seed_user(session):
    r = _login(session, EMAIL, ORIG_PW)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and "user" in body
    assert body["user"].get("email_address") == EMAIL


def test_login_wrong_pw(session):
    r = _login(session, EMAIL, "wrong-password-xyz")
    assert r.status_code == 401
    # No leak of the email in the body (generic auth error)
    assert EMAIL not in r.text


# --- Change password flow -----------------------------------------------------
def test_change_password_wrong_current(session):
    r = _login(session, EMAIL, ORIG_PW)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    r2 = _set_pw(session, token, "wrong-current-pw", "BrandNewPw123!")
    assert r2.status_code == 401
    assert "current password" in r2.text.lower()


def test_change_password_happy_path_then_revert(session):
    # 1. Login with original pw
    r = _login(session, EMAIL, ORIG_PW)
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    # 2. Change password
    r2 = _set_pw(session, token, ORIG_PW, TEMP_PW)
    assert r2.status_code == 200, r2.text
    assert r2.json().get("success") is True

    # 3. Login with OLD pw should now fail
    r3 = _login(session, EMAIL, ORIG_PW)
    assert r3.status_code == 401, f"Old pw still works! {r3.text}"

    # 4. Login with NEW pw should succeed
    r4 = _login(session, EMAIL, TEMP_PW)
    assert r4.status_code == 200, r4.text
    new_token = r4.json()["token"]

    # 5. Revert password back to ORIG_PW so future agents/users can still sign in
    r5 = _set_pw(session, new_token, TEMP_PW, ORIG_PW)
    assert r5.status_code == 200, f"REVERT FAILED — seeded credential is now {TEMP_PW}! {r5.text}"

    # 6. Confirm ORIG_PW works again
    r6 = _login(session, EMAIL, ORIG_PW)
    assert r6.status_code == 200, f"Original pw not restored! {r6.text}"


# --- Support contact regression -----------------------------------------------
def test_support_contact_still_works(session):
    r = _login(session, EMAIL, ORIG_PW)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    r2 = session.post(
        f"{BASE_URL}/api/support/contact",
        json={"subject": "TEST_iter11", "message": "regression check", "category": "general"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code in (200, 201), r2.text
