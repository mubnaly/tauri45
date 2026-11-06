// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { applyBrand, setState, state } from '../store';
import type { LoginInput, Session, Tenant } from '../types';
import { bridge } from './tauri-bridge';

/**
 * Authentication + tenant resolution.
 *
 * In the native shell the web-service token never leaves Rust: `auth_login`
 * stores it and `ws_call` attaches it server-side. Here we only keep the
 * non-secret session view.
 */
export async function signIn(input: LoginInput): Promise<Session> {
    const session = await bridge.authLogin(input);
    setState({ session });
    await hydrateTenant(session);

    return session;
}

/** Restores the last native session (multi-tenant: first stored tenant). */
export async function restoreSession(): Promise<Session | null> {
    const sessions = await bridge.authSessions();
    const session = sessions[0] ?? null;
    if (!session) {
        return null;
    }

    setState({ session });
    await hydrateTenant(session);

    return session;
}

/** Resolves the tenant registry entry, cached branding and badge state. */
export async function hydrateTenant(session: Session): Promise<void> {
    let tenant: Tenant | null = null;

    try {
        tenant = await bridge.tenantResolve(session.tenantId);
        setState({ tenant });
    } catch {
        tenant = null;
    }

    if (tenant) {
        applyBrand({
            appName: tenant.description?.replace(' Learning Platform', '') ?? tenant.id,
            primaryColor: state.brand.primaryColor,
        });
    }

    try {
        const branding = await bridge.tenantBranding(session.tenantId);
        if (branding) {
            applyBrand({
                appName: branding.appName ?? state.brand.appName,
                primaryColor: branding.primaryColor ?? state.brand.primaryColor,
            });
        }
    } catch {
        // Offline start: keep the previous/registry branding.
    }

    await refreshBadges();
}

export async function refreshBadges(): Promise<void> {
    if (!state.session) {
        return;
    }

    try {
        const badges = await bridge.badgesState(state.session.tenantId, state.session.userId);
        setState({ badges });
    } catch {
        setState({ badges: [] });
    }
}

export async function signOut(): Promise<void> {
    if (state.session) {
        try {
            await bridge.authLogout(state.session.tenantId);
        } catch {
            // Even if the native call fails the UI must be able to sign out.
        }
    }

    setState({ session: null, tenant: null, badges: [] });
}
