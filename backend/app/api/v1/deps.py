from app.providers.gateway import ModelGateway


def get_gateway() -> ModelGateway:
    return ModelGateway()
