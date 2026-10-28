from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.errors import ApiError


def _fernet() -> Fernet:
    key = get_settings().encryption_key
    if not key:
        raise ApiError(503, "ENCRYPTION_NOT_CONFIGURED", "服务端尚未配置密钥加密主密钥")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ApiError(503, "ENCRYPTION_KEY_INVALID", "服务端密钥加密配置无效") from exc


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise ApiError(500, "SECRET_DECRYPTION_FAILED", "无法读取服务商密钥，请重新配置") from exc
