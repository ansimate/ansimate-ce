import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import asyncio

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
try:
    SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
except ValueError:
    SMTP_PORT = 587
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "test@gmail.com")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "password")
SMTP_SENDER = os.environ.get("SMTP_SENDER", "test@gmail.com")

def send_email_sync(to_email: str, subject: str, html_content: str, text_content: str = None):
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_SENDER
        msg["To"] = to_email

        if text_content:
            part1 = MIMEText(text_content, "plain", "utf-8")
            msg.attach(part1)
        part2 = MIMEText(html_content, "html", "utf-8")
        msg.attach(part2)

        # Connection setup
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
            server.ehlo()
            server.starttls()
            server.ehlo()

        if SMTP_USERNAME and SMTP_PASSWORD:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)

        server.sendmail(SMTP_SENDER, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"SMTP Error: Failed to send email to {to_email}: {e}")
        return False

async def send_email(to_email: str, subject: str, html_content: str, text_content: str = None):
    # Run in thread pool to prevent blocking FastAPI async event loop
    return await asyncio.to_thread(send_email_sync, to_email, subject, html_content, text_content)
