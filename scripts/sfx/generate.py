import argparse
import hashlib
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate one ATLAS SFX WAV with Stable Audio 3 Small SFX.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    try:
        import torchaudio
        from stable_audio_3 import StableAudioModel
    except ImportError as exc:
        print("ATLAS LOCAL SFX: missing Stable Audio 3 dependencies. Install the SFX runtime before rendering.", file=sys.stderr)
        raise SystemExit(2) from exc

    device = os.environ.get("ATLAS_SFX_DEVICE") or None
    model = StableAudioModel.from_pretrained("small-sfx", device=device)
    seed = args.seed
    if seed is None:
        seed = int(hashlib.sha1(f"{args.prompt}|{args.duration:.2f}".encode()).hexdigest()[:8], 16)
    steps = int(os.environ.get("ATLAS_SFX_STEPS", "16"))
    audio = model.generate(
        prompt=args.prompt,
        duration=max(0.25, min(1.8, args.duration)),
        steps=steps,
        seed=seed,
        batch_size=1,
    )
    waveform = audio[0].detach().float().cpu()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    torchaudio.save(args.output, waveform, model.sample_rate)
    print(f"ATLAS LOCAL SFX: generated {args.output} | seed={seed} | steps={steps}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
