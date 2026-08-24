/**
 * Google Firebase Firestore Real-Time Cloud Sync Service
 * Enables instant multi-device synchronization (< 100ms) between:
 * - jaffadan@gmail.com
 * - Tracy734g@gmail.com
 *
 * Automatically shares:
 * 1. Live draft nominations, winning bids, and roster slots.
 * 2. Real-time Undo / Redo across both laptops.
 * 3. Shared Gemini 3.7 AI intelligence cache (pre-draft & live wire).
 */

const FIREBASE_CONFIG_STORAGE = 'fantasy_draft_firebase_config_v1';
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyA3PPyrBMrCSiIttnhkLm2oXCSeycoFPW0",
  authDomain: "gen-lang-client-05201032-47eab.firebaseapp.com",
  projectId: "gen-lang-client-05201032-47eab",
  storageBucket: "gen-lang-client-05201032-47eab.firebasestorage.app",
  messagingSenderId: "1080393432369",
  appId: "1:1080393432369:web:ef6239a6fb1e01c7848410",
  measurementId: "G-H2B0GNXLET"
};

export class FirestoreSyncService {
  constructor() {
    this.db = null;
    this.app = null;
    this.isInitialized = false;
    this.isConnected = false;
    this.isSyncing = false;
    this.currentUser = null;
    this.stateUnsubscribe = null;
    this.aiCacheUnsubscribe = null;
    this.chatUnsubscribe = null;
    this.statusCallbacks = [];
    this.remoteActionCallbacks = [];
    this.chatCallbacks = [];
    this.lastLocalWriteTimestamp = 0;
    this.localWriteLockDuration = 800; // Ignore echo snapshots for 800ms
  }

  onChatMessage(callback) {
    this.chatCallbacks.push(callback);
  }

  onStatusChange(callback) {
    this.statusCallbacks.push(callback);
    callback({
      isConnected: this.isConnected,
      isSyncing: this.isSyncing,
      user: this.currentUser
    });
  }

  onRemoteAction(callback) {
    this.remoteActionCallbacks.push(callback);
  }

  notifyStatus() {
    for (const cb of this.statusCallbacks) {
      try {
        cb({
          isConnected: this.isConnected,
          isSyncing: this.isSyncing,
          user: this.currentUser
        });
      } catch (e) {
        console.error('Status callback error:', e);
      }
    }
  }

  notifyRemoteAction(action) {
    for (const cb of this.remoteActionCallbacks) {
      try {
        cb(action);
      } catch (e) {
        console.error('Remote action callback error:', e);
      }
    }
  }

  async init(store, geminiService, user = null) {
    this.store = store;
    this.gemini = geminiService;
    this.currentUser = user;

    const savedConfig = localStorage.getItem(FIREBASE_CONFIG_STORAGE);
    const config = savedConfig ? JSON.parse(savedConfig) : DEFAULT_FIREBASE_CONFIG;

    if (!window.firebase) {
      console.warn('Firebase SDK not loaded, running in local-only mode');
      return;
    }

    try {
      if (!window.firebase.apps.length) {
        this.app = window.firebase.initializeApp(config);
      } else {
        this.app = window.firebase.app();
      }

      this.db = window.firebase.firestore();
      
      // Enable Firestore offline persistence if supported
      try {
        this.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      } catch (e) {}

      this.isInitialized = true;
      this.isConnected = true;
      this.notifyStatus();

      // Start Real-Time Listeners
      this.listenToDraftState();
      this.listenToAiCache();
      this.listenToChat();

      // Upload any local AI cache to Cloud DB so other laptop gets it
      this.syncLocalAiCacheToCloud();

      console.log('⚡ [Firestore Sync] Real-time cloud database connected to project:', config.projectId);
    } catch (e) {
      console.warn('⚡ [Firestore Sync] Initialization notice:', e.message);
      this.isConnected = false;
      this.notifyStatus();
    }
  }

  setUser(user) {
    this.currentUser = user;
    this.notifyStatus();
  }

  /**
   * Listen to real-time draft state changes from other laptop
   */
  listenToDraftState() {
    if (!this.db) return;

    const draftDoc = this.db.collection('leagues').doc('2026_draft');

    this.stateUnsubscribe = draftDoc.onSnapshot((doc) => {
      if (!doc.exists) {
        // Document does not exist yet in cloud -> create initial state from local
        if (this.store && this.store.state) {
          this.pushDraftState(this.store.state, 'Initial Cloud State Sync');
        }
        return;
      }

      const cloudData = doc.data();
      if (!cloudData) return;

      // Avoid echo loops if this update was triggered by our own recent write
      if (Date.now() - this.lastLocalWriteTimestamp < this.localWriteLockDuration) {
        return;
      }

      // Check if remote state is newer or different
      if (this.store && cloudData.state) {
        const localPick = this.store.state.currentPickNumber;
        const remotePick = cloudData.state.currentPickNumber;
        const updatedBy = cloudData.lastUpdatedBy || 'Partner';
        const action = cloudData.lastAction || 'Draft update';

        console.log(`⚡ [Firestore Sync] Received cloud update from ${updatedBy}: "${action}"`);

        this.isSyncing = true;
        this.notifyStatus();

        // Apply remote state to local store
        this.store.mergeRemoteState(cloudData.state);

        // Notify user with remote action toast if changed by partner
        if (this.currentUser && updatedBy && updatedBy !== this.currentUser.email) {
          this.notifyRemoteAction({
            user: updatedBy,
            action: action,
            timestamp: cloudData.lastUpdatedAt || Date.now()
          });
        }

        setTimeout(() => {
          this.isSyncing = false;
          this.notifyStatus();
        }, 300);
      }
    }, (error) => {
      console.warn('⚡ [Firestore Sync] Draft listener error:', error);
      this.isConnected = false;
      this.notifyStatus();
    });
  }

  /**
   * Push local draft state change to Firestore Cloud DB
   */
  async pushDraftState(state, actionDescription = 'Update draft') {
    if (!this.db || !state) return;

    this.lastLocalWriteTimestamp = Date.now();
    this.isSyncing = true;
    this.notifyStatus();

    try {
      const draftDoc = this.db.collection('leagues').doc('2026_draft');
      await draftDoc.set({
        state: state,
        lastUpdatedBy: this.currentUser ? this.currentUser.email : 'jaffadan@gmail.com',
        lastAction: actionDescription,
        lastUpdatedAt: Date.now()
      }, { merge: true });

      console.log(`⚡ [Firestore Sync] Pushed to cloud: "${actionDescription}"`);
    } catch (e) {
      console.warn('⚡ [Firestore Sync] Failed to push draft state:', e);
    } finally {
      this.isSyncing = false;
      this.notifyStatus();
    }
  }

  /**
   * Listen to real-time Gemini AI Intelligence cache from cloud
   */
  listenToAiCache() {
    if (!this.db || !this.gemini) return;

    const aiCacheCol = this.db.collection('leagues').doc('2026_draft').collection('ai_cache');

    this.aiCacheUnsubscribe = aiCacheCol.onSnapshot((snapshot) => {
      let newEntriesCount = 0;
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data();
          if (data && data.playerId && data.intel) {
            if (!this.gemini.cache[data.playerId]) {
              newEntriesCount++;
            }
            this.gemini.cache[data.playerId] = {
              timestamp: data.timestamp || Date.now(),
              data: data.intel
            };
          }
        }
      });

      if (newEntriesCount > 0) {
        this.gemini.saveCache();
        console.log(`⚡ [Firestore Sync] Synced ${newEntriesCount} new AI scouting reports from Cloud DB`);
        if (window.app && typeof window.app.updatePreloadUI === 'function') {
          window.app.updatePreloadUI(this.gemini.getPreloadedCount(window.app.store?.state?.players?.length || 310));
          if (window.app.store?.state?.activeTab === 'ai-admin') {
            window.app.renderAiAdmin();
          }
        }
      }
    }, (error) => {
      console.warn('⚡ [Firestore Sync] AI cache listener error:', error);
    });
  }

  /**
   * Save a single player AI scouting intel to Cloud DB
   */
  async saveAiPlayerIntel(playerId, intel) {
    if (!this.db || !playerId || !intel) return;

    try {
      const docRef = this.db.collection('leagues').doc('2026_draft').collection('ai_cache').doc(playerId);
      await docRef.set({
        playerId: playerId,
        intel: intel,
        timestamp: Date.now(),
        updatedBy: this.currentUser ? this.currentUser.email : 'jaffadan@gmail.com'
      }, { merge: true });
    } catch (e) {
      console.warn(`⚡ [Firestore Sync] Failed to save AI intel for ${playerId}:`, e);
    }
  }

  /**
   * Sync all existing local AI cache entries to Firestore Cloud DB
   */
  async syncLocalAiCacheToCloud() {
    if (!this.db || !this.gemini || !this.gemini.cache) return;

    const keys = Object.keys(this.gemini.cache);
    if (keys.length === 0) return;

    console.log(`⚡ [Firestore Sync] Syncing ${keys.length} local AI reports to Cloud DB...`);
    const batch = this.db.batch();
    const aiCacheCol = this.db.collection('leagues').doc('2026_draft').collection('ai_cache');

    let count = 0;
    for (const pId of keys) {
      const item = this.gemini.cache[pId];
      if (item && item.data) {
        const docRef = aiCacheCol.doc(pId);
        batch.set(docRef, {
          playerId: pId,
          intel: item.data,
          timestamp: item.timestamp || Date.now(),
          updatedBy: this.currentUser ? this.currentUser.email : 'jaffadan@gmail.com'
        }, { merge: true });
        count++;
      }
    }

    if (count > 0) {
      try {
        await batch.commit();
        console.log(`⚡ [Firestore Sync] Successfully committed ${count} AI reports to Cloud DB`);
      } catch (e) {
        console.warn('⚡ [Firestore Sync] Batch AI sync warning:', e);
      }
    }
  }

  /**
   * Listen to real-time chat messages between partners
   */
  listenToChat() {
    if (!this.db) return;
    const chatCol = this.db.collection('leagues').doc('2026_draft').collection('chat_messages');

    this.chatUnsubscribe = chatCol.orderBy('timestamp', 'desc').limit(20).onSnapshot((snapshot) => {
      const messages = [];
      snapshot.forEach((doc) => {
        messages.push({ id: doc.id, ...doc.data() });
      });
      // Sort ascending (oldest to newest for feed display)
      messages.sort((a, b) => a.timestamp - b.timestamp);

      for (const cb of this.chatCallbacks) {
        try {
          cb(messages);
        } catch (e) {
          console.error('Chat callback error:', e);
        }
      }
    }, (error) => {
      console.warn('⚡ [Firestore Sync] Chat listener warning:', error);
    });
  }

  /**
   * Send a real-time chat message to partner
   */
  async sendChatMessage(text) {
    if (!this.db || !text || !text.trim()) return false;
    try {
      const userEmail = this.currentUser ? this.currentUser.email : 'jaffadan@gmail.com';
      const displayName = userEmail.toLowerCase().includes('tracy') ? 'Tracy' : 'Dan';
      const chatCol = this.db.collection('leagues').doc('2026_draft').collection('chat_messages');
      await chatCol.add({
        sender: userEmail,
        displayName: displayName,
        text: text.trim(),
        timestamp: Date.now()
      });
      return true;
    } catch (e) {
      console.error('⚡ [Firestore Sync] Failed to send chat message:', e);
      return false;
    }
  }

  saveCustomConfig(config) {
    localStorage.setItem(FIREBASE_CONFIG_STORAGE, JSON.stringify(config));
    if (this.store && this.gemini) {
      this.init(this.store, this.gemini, this.currentUser);
    }
  }
}
