(() => {
  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
  const backdrop = document.getElementById('authBackdrop');
  const form = document.getElementById('authForm');
  const nameField = document.getElementById('authName');
  const emailField = document.getElementById('authEmail');
  const passwordField = document.getElementById('authPassword');
  const message = document.getElementById('authMessage');
  const title = document.getElementById('authTitle');
  const description = document.getElementById('authDescription');
  const submit = document.getElementById('authSubmit');
  const switchButton = document.getElementById('authSwitch');
  const switchText = document.getElementById('authSwitchText');
  const logout = document.getElementById('authLogout');
  const openButton = document.getElementById('authOpen');
  const avatar = document.getElementById('profileAvatar');
  let mode = 'signup';

  function showMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? '#ff9a8d' : '';
  }
  function setMode(nextMode) {
    mode = nextMode;
    const signingUp = mode === 'signup';
    title.textContent = signingUp ? 'Your music. Your account.' : 'Welcome back.';
    description.textContent = signingUp ? 'Create an account to join 4TVIBEZ MUSIC.' : 'Log in to your 4TVIBEZ MUSIC account.';
    nameField.parentElement.hidden = !signingUp;
    passwordField.autocomplete = signingUp ? 'new-password' : 'current-password';
    submit.innerHTML = signingUp ? 'Create account <span>→</span>' : 'Log in <span>→</span>';
    switchText.textContent = signingUp ? 'Already have an account?' : 'New to 4TVIBEZ MUSIC?';
    switchButton.textContent = signingUp ? 'Log in' : 'Create account';
    showMessage('');
  }
  function openDialog() { backdrop.hidden = false; showMessage(''); }
  function closeDialog() { backdrop.hidden = true; }
  openButton.addEventListener('click', openDialog);
  avatar.addEventListener('click', openDialog);
  document.getElementById('authClose').addEventListener('click', closeDialog);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeDialog(); });
  switchButton.addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    showMessage(mode === 'signup' ? 'Creating your account…' : 'Logging you in…');
    const email = emailField.value.trim();
    const password = passwordField.value;
    let result;
    if (mode === 'signup') {
      result = await client.auth.signUp({
        email, password,
        options: { data: { display_name: nameField.value.trim() || email.split('@')[0], account_type: 'listener' } }
      });
    } else {
      result = await client.auth.signInWithPassword({ email, password });
    }
    submit.disabled = false;
    if (result.error) {
      showMessage(result.error.message, true);
      return;
    }
    if (mode === 'signup' && !result.data.session) {
      showMessage('Account created. Check your email to confirm your address, then log in.');
      setMode('login');
      return;
    }
    showMessage('You are signed in. Welcome to the vibe!');
    updateAccount(result.data.user);
    setTimeout(closeDialog, 1000);
  });

  function updateAccount(user) {
    if (user) {
      const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || '4T';
      openButton.textContent = displayName;
      avatar.textContent = displayName.slice(0, 2).toUpperCase();
      logout.hidden = false;
    } else {
      openButton.textContent = 'Log in';
      avatar.textContent = '4T';
      logout.hidden = true;
    }
  }
  logout.addEventListener('click', async () => {
    const { error } = await client.auth.signOut();
    if (error) showMessage(error.message, true);
    else { updateAccount(null); showMessage('You have logged out.'); setMode('login'); }
  });
  client.auth.getSession().then(({ data }) => updateAccount(data.session?.user || null));
  client.auth.onAuthStateChange((_event, session) => updateAccount(session?.user || null));
  window.fourTvibezAuth = client.auth;
  setMode('signup');
})();