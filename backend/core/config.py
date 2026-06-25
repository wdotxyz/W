"""Centralised env vars and immutable constants for W backend."""
import os
import re
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / '.env')

# ----- Secrets / 3rd party -----
JWT_SECRET = os.environ.get('JWT_SECRET', 'wave-secret')
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY', '')
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER', '')
DAILY_API_KEY = os.environ.get('DAILY_API_KEY', '')
DAILY_SUBDOMAIN = os.environ.get('DAILY_SUBDOMAIN', '')

# ----- Static config -----
AI_USER_ID = 'ai-assistant-wave'
MAIL_DOMAIN = os.environ.get('MAIL_DOMAIN', 'w.xyz')
MAIL_FROM_DEFAULT = os.environ.get('MAIL_FROM_DEFAULT', f'noreply@{MAIL_DOMAIN}')

DAILY_API_BASE = 'https://api.daily.co/v1'
DAILY_CALL_TTL = 1800  # 30 minutes

# ----- Password / auth policy -----
MIN_PASSWORD_LEN = 8
MAX_BCRYPT_BYTES = 72
FAILED_LOGIN_LIMIT = 5
FAILED_LOGIN_WINDOW_MINUTES = 15
LOCK_MINUTES = 15
GENERIC_AUTH_ERROR = 'Invalid email or password'

# ----- Handle policy -----
HANDLE_PREMIUM_MIN = 4
HANDLE_FREE_MIN = 6
HANDLE_MAX = 26
HANDLE_HARD_MIN = 4
HANDLE_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,24}[a-z0-9]$|^[a-z0-9]$')

# ----- Billing -----
PLAN_CATALOG = {
    ('plus', 'month'): {'amount': 4.99, 'days': 30, 'tier': 'plus', 'label': 'W Plus · Monthly'},
    ('plus', 'year'):  {'amount': 49.00, 'days': 365, 'tier': 'plus', 'label': 'W Plus · Yearly'},
    ('pro',  'month'): {'amount': 9.99, 'days': 30, 'tier': 'pro', 'label': 'W Pro · Monthly'},
    ('pro',  'year'):  {'amount': 99.00, 'days': 365, 'tier': 'pro', 'label': 'W Pro · Yearly'},
}
TIER_STORAGE_GB = {'free': 1, 'plus': 50, 'pro': 100}

# MVP-wide hard storage cap per user (regardless of tier). Override / remove
# this once paid plans are launched and per-tier limits resume.
MVP_STORAGE_BYTES = 10 * 1024 * 1024  # 10 MB per user during MVP

# ----- Blocklists -----
RESERVED_HANDLES = {
    # System / role accounts
    'admin', 'administrator', 'root', 'support', 'help', 'helpdesk', 'info', 'contact',
    'noreply', 'no-reply', 'postmaster', 'abuse', 'hostmaster', 'webmaster',
    'mail', 'email', 'ceo', 'legal', 'billing', 'sales', 'security', 'team',
    'press', 'media', 'feedback', 'newsletter', 'marketing', 'hr', 'jobs',
    'careers', 'privacy', 'terms', 'policy', 'moderator', 'mod', 'staff',
    'official', 'verified', 'premium', 'pro', 'plus',
    # W / Wave product names
    'wave', 'waveai', 'ai', 'wmail', 'w-mail', 'w', 'ww', 'www', 'wxyz',
    # Big-tech trademarks
    'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook', 'instagram',
    'whatsapp', 'twitter', 'tiktok', 'snapchat', 'linkedin', 'youtube',
    'netflix', 'spotify', 'uber', 'lyft', 'airbnb', 'stripe', 'openai', 'claude',
    'anthropic', 'gemini', 'chatgpt', 'github', 'gitlab', 'dropbox', 'slack',
    'discord', 'telegram', 'signal', 'zoom', 'twitch', 'reddit', 'pinterest',
    'tesla', 'spacex', 'nvidia', 'oracle', 'ibm', 'intel', 'amd', 'samsung',
    'sony', 'huawei', 'xiaomi', 'lenovo', 'dell', 'hp',
    # Other major brands
    'nike', 'adidas', 'puma', 'reebok', 'gucci', 'prada', 'chanel', 'rolex',
    'ferrari', 'porsche', 'lamborghini', 'bmw', 'mercedes', 'audi', 'toyota',
    'honda', 'ford', 'chevrolet', 'starbucks', 'mcdonalds', 'kfc', 'subway',
    'burgerking', 'dominos', 'pizzahut', 'cocacola', 'pepsi', 'redbull',
    # Crypto / finance
    'bitcoin', 'btc', 'ethereum', 'eth', 'coinbase', 'binance', 'robinhood',
    'paypal', 'venmo', 'cashapp', 'visa', 'mastercard', 'amex',
    # Celebrity / icons
    'beyonce', 'drake', 'eminem', 'rihanna', 'kanye', 'jayz', 'jay-z',
    'taylorswift', 'taylor-swift', 'ladygaga', 'lady-gaga', 'billieeilish',
    'billie-eilish', 'arianagrande', 'ariana-grande', 'selenagomez',
    'elonmusk', 'elon', 'musk', 'obama', 'biden', 'trump', 'kardashian',
    'kim-k', 'kimk', 'queen', 'kingjames', 'lebron', 'messi', 'ronaldo',
    'mrbeast', 'pewdiepie', 'ninja', 'shroud',
    # Religious / sensitive
    'god', 'jesus', 'allah', 'buddha', 'satan', 'devil',
}

PROFANITY_FRAGMENTS = {
    'fuck', 'shit', 'bitch', 'cunt', 'asshol', 'asshat', 'bastard', 'dickhead',
    'pussy', 'twat', 'wank', 'cock', 'boob', 'tit', 'anal', 'porn',
    'nigger', 'nigga', 'n1gger', 'n1gga', 'faggot', 'fag', 'retard', 'kike',
    'spic', 'chink', 'gook', 'tranny', 'whore', 'slut', 'rapist', 'rape',
    'nazi', 'hitler', 'isis', 'kkk', 'pedophile', 'pedo', 'molest',
}
