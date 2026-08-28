import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate one ATLAS SFX WAV with Stable Audio 3 Small SFX.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        import torch
        import torchaudio
        from stable_audio_3 import StableAudioModel
    except ImportError as exc:
        print(
            "ATLAS LOCAL SFX: missing Stable Audio 3 dependencies. "
            "Install the SFX runtime before rendering.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc

    device = os.environ.get("ATLAS_SFX_DEVICE") or None
    model = StableAudioModel.from_pretrained("small-sfx", device=device)

    audio = model.generate(
        prompt=args.prompt,
        duration=max(0.25, min(1.8, args.duration)),
        steps=int(os.environ.get("ATLAS_SFX_STEPS", "8")),
        seed=-1,
        batch_size=1,
    )

    # Stable Audio 3 returns (batch, channels, samples). Save the first item.
    waveform = audio[0].detach().float().cpu()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    torchaudio.save(args.output, waveform, model.sample_rate)
    print(f"ATLAS LOCAL SFX: generated {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
