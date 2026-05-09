"""Slime voice agent: local ASR, GPT-4o-mini routing, validated tools."""

from foresight_x.voice.asr import TranscriptionResult, transcribe_audio, warmup_asr_model

__all__ = ["TranscriptionResult", "transcribe_audio", "warmup_asr_model"]
