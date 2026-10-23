import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Eye, EyeOff, Fingerprint, Pencil, Save, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { removeLogin, saveLogin, unlockLogin, verifyBiometrics, type LoginDetails } from './secureLogin';

function Action(props: React.ComponentProps<typeof Pressable>) {
  return <Pressable {...props} onPressIn={() => void Haptics.selectionAsync().catch(() => {})} />;
}

export function SecureLoginContent({ onFill, onClose, autoFill }: {
  onFill: (details: LoginDetails) => void;
  onClose: () => void;
  autoFill: boolean;
}) {
  const [details, setDetails] = useState<LoginDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const mounted = useRef(true);
  const authenticating = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const operation = useRef(0);
  const inFlight = useRef(false);
  const run = useCallback(async (action: (isActive: () => boolean) => Promise<void>) => {
    if (inFlight.current || !mounted.current || !foreground.current) return;
    const token = ++operation.current;
    const isActive = () => mounted.current && foreground.current && operation.current === token;
    inFlight.current = true;
    setBusy(true); setError(''); authenticating.current = true;
    try { await action(isActive); }
    catch (e) { if (isActive()) setError(e instanceof Error ? e.message : 'Unable to complete action.'); }
    finally {
      if (operation.current === token) {
        inFlight.current = false;
        authenticating.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);
  const unlock = useCallback(() => run(async (isActive) => {
    const value = await unlockLogin(isActive);
    if (!isActive()) return;
    if (value && autoFill) { onFill(value); return; }
    setDetails(value || { username: '', password: '' }); setEditing(!value);
  }), [autoFill, onFill, run]);
  useEffect(() => {
    mounted.current = true;
    void unlock();
    const listener = AppState.addEventListener('change', (state) => {
      // iOS biometric prompts briefly move the app to inactive.
      if (state === 'background' || (state === 'inactive' && !authenticating.current)) {
        foreground.current = false; operation.current += 1; inFlight.current = false;
        setDetails(null); setRevealed(false); onClose();
      } else if (state === 'active') foreground.current = true;
    });
    return () => { mounted.current = false; operation.current += 1; inFlight.current = false; listener.remove(); };
  }, [onClose, unlock]);
  return (
    <View style={styles.content}>
      {busy ? <ActivityIndicator color="#E3A325" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!details ? (
        <>
          <Action disabled={busy} style={styles.button} onPress={() => void unlock()} accessibilityLabel="Unlock Secure Login">
            <Fingerprint size={20} color="#151B17" /><Text style={styles.buttonText}>Unlock</Text>
          </Action>
          {error ? <Action disabled={busy} style={styles.secondary} onPress={() => void run(async (isActive) => { await removeLogin(isActive); if (isActive()) { setDetails({ username: '', password: '' }); setEditing(true); } })}>
            <Trash2 size={18} color="#922E24" /><Text>Reset saved login</Text>
          </Action> : null}
        </>
      ) : editing ? (
        <>
          <Text style={styles.label}>LMS username</Text>
          <TextInput style={styles.input} value={details.username} onChangeText={(username) => setDetails({ ...details, username })}
            autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" editable={!busy} accessibilityLabel="LMS username" />
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput style={[styles.input, styles.passwordInput]} value={details.password} onChangeText={(password) => setDetails({ ...details, password })}
              secureTextEntry={!revealed} autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" editable={!busy} accessibilityLabel="LMS password" />
            <Action style={styles.iconButton} disabled={busy} accessibilityLabel={revealed ? 'Hide password' : 'Show password'} onPress={() => setRevealed(!revealed)}>
              {revealed ? <EyeOff size={20} color="#151B17" /> : <Eye size={20} color="#151B17" />}
            </Action>
          </View>
          <Action disabled={busy} style={styles.button} onPress={() => void run(async (isActive) => { await saveLogin(details, isActive); if (isActive()) { setEditing(false); setRevealed(false); } })}>
            <Save size={19} color="#151B17" /><Text style={styles.buttonText}>Save login</Text>
          </Action>
        </>
      ) : (
        <>
          <Text style={styles.label}>{details.username}</Text>
          <Action disabled={busy} style={styles.button} onPress={() => onFill(details)}>
            <Fingerprint size={20} color="#151B17" /><Text style={styles.buttonText}>Fill LMS login</Text>
          </Action>
          <Action disabled={busy} style={styles.secondary} onPress={() => void run(async (isActive) => { await verifyBiometrics(isActive); if (isActive()) setEditing(true); })}>
            <Pencil size={18} color="#151B17" /><Text>Edit saved login</Text>
          </Action>
          <Action disabled={busy} style={styles.secondary} onPress={() => void run(async (isActive) => { await removeLogin(isActive); if (isActive()) onClose(); })}>
            <Trash2 size={18} color="#922E24" /><Text>Delete saved login</Text>
          </Action>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 24 },
  error: { color: '#922E24', fontSize: 14, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#151B17' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#BCC5BD', borderRadius: 8, paddingHorizontal: 12, color: '#151B17', fontSize: 16 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passwordInput: { flex: 1, minWidth: 0 },
  iconButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, padding: 12, borderRadius: 8, backgroundColor: '#E3A325', flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontWeight: '700', color: '#151B17', fontSize: 15 },
  secondary: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
});
