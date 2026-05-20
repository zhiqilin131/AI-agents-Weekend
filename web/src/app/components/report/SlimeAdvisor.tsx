import { lazy, Suspense } from 'react';
import type { SlimeAdvisorProps, SlimeAdvisorState } from './slimeAdvisorTypes';
import { SlimeAdvisor2D } from './SlimeAdvisor2D';
import { useSlimeWebGL } from '../../../features/slime/visual3d/useSlimeWebGL';
import { defaultMouthAnchorY } from '../../../features/slime/visual3d/slimeMotionBridge';
import { slimeCanvasLayout, slimeVariantFromProps } from '../../../features/slime/visual3d/slime3dConfig';

export type { SlimeAdvisorState, SlimeAdvisorProps } from './slimeAdvisorTypes';

export { defaultMouthAnchorY as getSlimeMouthAnchorDefault };

const SlimeAdvisor3DLazy = lazy(() =>
  import('../../../features/slime/visual3d/SlimeAdvisor3D').then((m) => ({
    default: m.SlimeAdvisor3D,
  })),
);

/** Empty placeholder while 3D loads — must NOT render 2D blue eye rings under the canvas. */
function SlimeAdvisor3DPlaceholder({
  size = 'md',
  companionMode = false,
  buddyPage = false,
  studioScene = false,
  className,
}: Pick<SlimeAdvisorProps, 'size' | 'companionMode' | 'buddyPage' | 'studioScene' | 'className'>) {
  const variant = slimeVariantFromProps({ size, companionMode, buddyPage, studioScene });
  const { spread: spreadPx } = slimeCanvasLayout(size, variant);
  const spread = spreadPx;
  return (
    <div
      className={className}
      style={{ width: spread, height: spread }}
      data-testid="slime-advisor"
      data-slime-render="loading"
      aria-hidden
    />
  );
}

export function SlimeAdvisor(props: SlimeAdvisorProps) {
  const { use3D } = useSlimeWebGL(props.force2D);

  if (!use3D) {
    return <SlimeAdvisor2D {...props} />;
  }

  return (
    <Suspense
      fallback={
        <SlimeAdvisor3DPlaceholder
          size={props.size}
          companionMode={props.companionMode}
          buddyPage={props.buddyPage}
          studioScene={props.studioScene}
          className={props.className}
        />
      }
    >
      <SlimeAdvisor3DLazy
        {...props}
        studioAura={props.studioAura}
        studioAccent={props.studioAccent}
        onMouthAnchor={props.onMouthAnchor}
      />
    </Suspense>
  );
}
