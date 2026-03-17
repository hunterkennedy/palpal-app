import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer()


async def verify_admin_token(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> str:
    """FastAPI dependency: validates the Bearer token matches CONDUCTOR_ADMIN_KEY."""
    expected = os.environ["CONDUCTOR_ADMIN_KEY"]
    if credentials.credentials != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    return credentials.credentials
