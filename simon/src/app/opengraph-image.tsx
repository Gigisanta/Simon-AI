import { createSocialImage, socialImageContentType, socialImageSize } from "./social-image";

export const alt = "Simón — un lugar para hablar, aprender y avanzar paso a paso";
export const size = socialImageSize;
export const contentType = socialImageContentType;

export default function OpenGraphImage() {
  return createSocialImage();
}
