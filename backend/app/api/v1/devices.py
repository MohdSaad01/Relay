"""Device endpoints: list, inspect, rename, and remove paired devices."""

from fastapi import APIRouter, Response, status

from app.api.dependencies import DeviceOwnerAuthDep, DeviceServiceDep
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.device import DeviceResponse, DeviceUpdateRequest

router = APIRouter()


@router.get("", response_model=ApiResponse)
def list_devices(service: DeviceServiceDep) -> ApiResponse:
    """Return every paired device."""
    devices = service.list_devices()
    data = [DeviceResponse.model_validate(device).model_dump(mode="json") for device in devices]
    return success(data)


@router.get("/{device_id}", response_model=ApiResponse)
def get_device(device_id: int, service: DeviceServiceDep) -> ApiResponse:
    """Return a single paired device by id."""
    device = service.get_device_or_raise(device_id)
    return success(DeviceResponse.model_validate(device).model_dump(mode="json"))


@router.patch("/{device_id}", response_model=ApiResponse)
def rename_device(
    device_id: int, body: DeviceUpdateRequest, service: DeviceServiceDep, _auth: DeviceOwnerAuthDep
) -> ApiResponse:
    """Rename a paired device. The desktop (loopback) may rename any device;
    a paired Android device may only rename itself (P23) — see
    verify_device_owner's own doc comment."""
    device = service.rename_device(device_id, body.device_name)
    return success(
        DeviceResponse.model_validate(device).model_dump(mode="json"),
        message="Device renamed successfully.",
    )


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_device(device_id: int, service: DeviceServiceDep) -> Response:
    """Unpair a device."""
    service.remove_device(device_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
