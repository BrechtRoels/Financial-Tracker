from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Account, User
from ..schemas import Token, UserCreate, UserOut, UserUpdate
from ..security import create_access_token, hash_password, verify_password
from ..seed import seed_default_categories

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/setup-required")
def setup_required(db: Session = Depends(get_db)) -> dict:
    count = db.query(User).count()
    return {"setup_required": count == 0}


@router.post("/setup", response_model=Token)
def setup(data: UserCreate, db: Session = Depends(get_db)) -> Token:
    if db.query(User).count() > 0:
        raise HTTPException(status_code=400, detail="Setup already completed")
    user = User(email=data.email, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    seed_default_categories(db, user.id)
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/signup", response_model=Token)
def signup(data: UserCreate, db: Session = Depends(get_db)) -> Token:
    """Create a regular (non-admin) account.

    Available at any time. New users are AI-enabled by default — the admin can
    toggle that off from /admin. The login literal "Admin" is reserved for the
    seeded admin account; reject collisions.
    """
    email = data.email.strip()
    if email.lower() == "admin":
        raise HTTPException(status_code=400, detail="That username is reserved.")
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="That email is already registered.")
    user = User(
        email=email,
        password_hash=hash_password(data.password),
        is_admin=False,
        ai_enabled=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    seed_default_categories(db, user.id)
    return Token(access_token=create_access_token(str(user.id)))


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return Token(access_token=create_access_token(str(user.id)))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if body.month_start_day is not None:
        user.month_start_day = body.month_start_day
    if "default_account_id" in body.model_fields_set:
        if body.default_account_id is None:
            user.default_account_id = None
        else:
            owned = (
                db.query(Account)
                .filter(Account.id == body.default_account_id, Account.user_id == user.id)
                .first()
            )
            if not owned:
                raise HTTPException(status_code=400, detail="Account not found")
            user.default_account_id = owned.id
    db.commit()
    db.refresh(user)
    return user
