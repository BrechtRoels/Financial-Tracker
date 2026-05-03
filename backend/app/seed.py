from sqlalchemy.orm import Session

from .models import Category

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
