from sqlalchemy.orm import Session

from .models import Category, User
from .security import hash_password

ADMIN_EMAIL = "Admin"
ADMIN_PASSWORD = "adminbrechtroels123"

DEFAULT_CATEGORIES = [
    # Expenses — muted corporate tints
    ("Groceries", "expense", "#DDE4E0"),
    ("Rent", "expense", "#DBE4F0"),
    ("Utilities", "expense", "#E0E4EA"),
    ("Transport", "expense", "#E8E2D5"),
    ("Dining", "expense", "#E5E1DC"),
    ("Entertainment", "expense", "#DEE5E8"),
    ("Health", "expense", "#D9E2EA"),
    ("Shopping", "expense", "#E2E8F0"),
    ("Other", "expense", "#EDEFF2"),
    # Income
    ("Salary", "income", "#DBE4F0"),
    ("Bonus", "income", "#DDE4E0"),
    ("Interest", "income", "#E0E4EA"),
]


def seed_default_categories(db: Session, user_id: int) -> None:
    for name, kind, color in DEFAULT_CATEGORIES:
        db.add(Category(user_id=user_id, name=name, kind=kind, color=color))
    db.commit()


def ensure_admin_user(db: Session) -> None:
    """Create the built-in admin login if it doesn't exist yet.

    The admin user has no transactions / accounts of their own — they exist
    only to manage runtime settings and toggle other users' AI access.
    Idempotent: running it on every startup is safe.
    """
    existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
    if existing:
        if not existing.is_admin:
            existing.is_admin = True
            db.commit()
        return
    db.add(
        User(
            email=ADMIN_EMAIL,
            password_hash=hash_password(ADMIN_PASSWORD),
            is_admin=True,
            ai_enabled=True,
        )
    )
    db.commit()
