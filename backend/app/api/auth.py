from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.audit import audit_log
from app.core.database import get_db
from app.core.security import UserContext, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def upsert_user(db: Session, current_user: UserContext) -> dict:
    stmt = text(
        """
        INSERT INTO users (id, auth0_sub, email, name)
        VALUES (gen_random_uuid(), :auth0_sub, :email, :name)
        ON CONFLICT (auth0_sub)
        DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            updated_at = NOW()
        RETURNING id, auth0_sub, email, name, created_at, updated_at;
        """
    )
    result = db.execute(
        stmt,
        {
            "auth0_sub": current_user.sub,
            "email": current_user.email,
            "name": current_user.name,
        },
    ).mappings().first()
    db.commit()
    return dict(result)


@router.get("/verify")
def verify(current_user: UserContext = Depends(get_current_user), db: Session = Depends(get_db)):
    user = upsert_user(db, current_user)
    audit_log("auth.verify", auth0_sub=current_user.sub, user_id=user["id"])
    return {"status": "ok", "user": user}


@router.get("/me")
def me(current_user: UserContext = Depends(get_current_user), db: Session = Depends(get_db)):
    user = upsert_user(db, current_user)
    audit_log("auth.me", auth0_sub=current_user.sub, user_id=user["id"])
    return {"user": user}
