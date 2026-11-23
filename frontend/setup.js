export function setupComplete(me) {
  return !!me?.profile?.onboarding_completed && !!me?.podcasts?.length;
}

export function initialScreen(me) {
  if (!me?.profile?.onboarding_completed) return "profile";
  if (!me?.podcasts?.length) return "podcasts";
  return "home";
}
