"""保留单帧 TIFF 像素的 PNG 派生图。"""
import base64
import hashlib
import io
import json
import sys
import warnings
from PIL import Image

Image.MAX_IMAGE_PIXELS = 150_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)

def process(data):
    try:
        image = Image.open(io.BytesIO(data))
        if image.format != "TIFF":
            return {"error": "IMAGE_FORMAT_UNSUPPORTED"}
        if getattr(image, "n_frames", 1) != 1:
            return {"error": "IMAGE_MULTIFRAME_UNSUPPORTED"}
        if image.width * image.height > 150_000_000:
            return {"error": "IMAGE_PIXELS_UNSUPPORTED"}
        if image.mode not in ("1", "L", "LA", "P", "RGB", "RGBA", "I;16"):
            return {"error": "IMAGE_MODE_UNSUPPORTED"}
        image.load()
        pixels = hashlib.sha256(image.tobytes()).hexdigest()
        output = io.BytesIO()
        image.save(output, format="PNG")
        data_png = output.getvalue()
        restored = Image.open(io.BytesIO(data_png))
        restored.load()
        if image.size != restored.size or image.mode != restored.mode or pixels != hashlib.sha256(restored.tobytes()).hexdigest():
            return {"error": "IMAGE_LOSSLESS_CHECK_FAILED"}
        # 调色板和透明度也必须保持。
        if image.mode == "P" and image.getpalette() != restored.getpalette():
            return {"error": "IMAGE_LOSSLESS_CHECK_FAILED"}
        if image.info.get("transparency") != restored.info.get("transparency"):
            return {"error": "IMAGE_LOSSLESS_CHECK_FAILED"}
        return {"base64": base64.b64encode(data_png).decode("ascii"), "sourceSizePixels": list(image.size), "derivedSizePixels": list(restored.size), "mode": image.mode, "pixelSha256": pixels}
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        return {"error": "IMAGE_PIXELS_UNSUPPORTED"}
    except Exception:
        return {"error": "IMAGE_DECODE_FAILED"}

if __name__ == "__main__":
    print(json.dumps(process(sys.stdin.buffer.read()), separators=(",", ":")))
