import { nextTick, type Ref } from 'vue';
import { cssZoom } from '../settings/uiScale';

export async function fitOnScreen(element: Readonly<Ref<HTMLElement | null>>, shift: Ref<number>) {
  shift.value = 0;
  await nextTick();
  if (!element.value) return;
  const overflow = element.value.getBoundingClientRect().right - (window.innerWidth - 8);
  // left is in zoomed pixels, the measurement in screen pixels, hence the division by cssZoom.
  if (overflow > 0) shift.value = -Math.ceil(overflow / cssZoom.value);
}
