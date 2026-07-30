from app.audio.device_discovery import parse_ffmpeg_dshow_audio_devices


def test_parse_ffmpeg_dshow_audio_devices():
    sample = """
[dshow @ 000001f68b9f6bc0] "Integrated Webcam"
[dshow @ 000001f68b9f6bc0]   Alternative name "@device_pnp_\\\\?\\usb#vid_0bda"
[dshow @ 000001f68b9f6bc0] "Speakers (USB Audio)"
[dshow @ 000001f68b9f6bc0]   Alternative name "@device_cm_{{33D9A762-90C8-11D0-BD43-00A0C911CE86}}\\\\wave_{123}"
"""
    devices = parse_ffmpeg_dshow_audio_devices(sample)
    assert "Integrated Webcam" in devices
    assert "Speakers (USB Audio)" in devices
