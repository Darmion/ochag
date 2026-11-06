export type VisionInput = {
  campaignFogEnabled: boolean;
  playerFogDisabledByGm: boolean;
  mayChooseAlliedVision: boolean;
  selectedVision: 'own' | 'allies';
  blinded: boolean;
  campaignBlindnessRadiusFeet: number;
  blindnessRadiusOverrideFeet?: number | null;
  allowAlliesWhileBlindByGm?: boolean | null;
};
export function resolveVision(input: VisionInput) {
  const radius = input.blindnessRadiusOverrideFeet ?? input.campaignBlindnessRadiusFeet;
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid vision radius');
  const bypassFog = !input.campaignFogEnabled || input.playerFogDisabledByGm;
  const alliedVision = input.mayChooseAlliedVision && input.selectedVision === 'allies'
    && (!input.blinded || input.allowAlliesWhileBlindByGm === true);
  return {
    bypassFog,
    alliedVision: !bypassFog && alliedVision,
    blindnessRadiusFeet: !bypassFog && input.blinded ? radius : null,
  };
}
