// Signup only needs favorite shows. Icebreakers unlock the group after matching.
export function setupComplete(me) {
  return !!me?.podcasts?.length;
}

export function initialScreen(me) {
  if (me?.needs_icebreakers) return "profile";
  if (me?.quartet) return "home";
  if (!setupComplete(me)) return "podcasts";
  return "home";
}
