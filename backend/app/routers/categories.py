from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Category, Transaction, User
from ..schemas import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Category).filter(Category.user_id == user.id).order_by(Category.kind, Category.name).all()
    )


@router.post("", response_model=CategoryOut)
def create_category(
    data: CategoryCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    cat = Category(user_id=user.id, **data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    data: CategoryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = db.query(Category).filter(Category.id == category_id, Category.user_id == user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}")
def delete_category(
    category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    cat = db.query(Category).filter(Category.id == category_id, Category.user_id == user.id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Not found")
    # Null out references on transactions rather than failing
    db.query(Transaction).filter(Transaction.category_id == cat.id).update({"category_id": None})
    db.delete(cat)
    db.commit()
    return {"ok": True}
