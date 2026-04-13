/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Bot, Shield, Zap, Users, Settings, LogOut, 
  Search, Trash2, Save, RefreshCw, 
  Terminal, LayoutDashboard,
  Clock, CheckCircle2, AlertCircle, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  orderBy,
  limit,
  getDoc
} from 'firebase/firestore';
import { auth, db, signIn, logOut } from './firebase';

// Types
interface UserData {
  id: string;
  tgId: string;
  name: string;
  role: 'normal' | 'vip' | 'autouser' | 'admin';
  uid?: string;
  expiryDate?: string;
  hasUsedFreeLike?: boolean;
  isVerified?: boolean;
  points?: number;
  referralCount?: number;
}

interface BotConfig {
  apiUrl: string;
  adminTgId: string;
}

interface LogEntry {
  id: string;
  message: string;
  timestamp: any;
  type: string;
}

// PWA Install Button Component
function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstall(false);
    }
    setDeferredPrompt(null);
  };

  if (!showInstall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-6">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center max-w-sm shadow-2xl"
      >
        <div className="w-16 h-16 bg-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Download className="w-8 h-8 text-indigo-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Install LikexAdmin</h2>
        <p className="text-slate-400 mb-8">Install this app to your home screen for quick access and a better experience.</p>
        <button 
          onClick={handleInstall}
          className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-900/50 hover:bg-indigo-500 transition-all"
        >
          Install Now
        </button>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'config' | 'logs'>('overview');
  
  // Data State
  const [users, setUsers] = useState<UserData[]>([]);
  const [config, setConfig] = useState<BotConfig>({ apiUrl: '', adminTgId: '' });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Listen to Users
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserData));
      setUsers(usersData);
    });

    // Listen to Config
    const unsubConfig = onSnapshot(doc(db, 'config', 'main'), (doc) => {
      if (doc.exists()) {
        setConfig(doc.data() as BotConfig);
      }
    });

    // Listen to Logs
    const qLogs = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogEntry));
      setLogs(logsData);
    });

    return () => {
      unsubUsers();
      unsubConfig();
      unsubLogs();
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl"
        >
          <div className="inline-flex items-center justify-center p-4 bg-indigo-500/10 rounded-2xl mb-6 border border-indigo-500/20">
            <Bot className="w-12 h-12 text-indigo-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Bot Dashboard</h1>
          <p className="text-slate-400 mb-8">Manage your AutoLike bot, users, and configurations in one place.</p>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-white text-slate-950 font-bold rounded-xl hover:bg-slate-200 transition-all flex items-center justify-center gap-3 shadow-lg shadow-white/5"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.tgId?.includes(searchTerm) ||
    u.uid?.includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex">
      {/* Sidebar */}
      <aside className="w-72 border-r border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div className="p-2 bg-indigo-500 rounded-lg">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">LikexAdmin</span>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {[
            { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
            { id: 'users', icon: Users, label: 'Users' },
            { id: 'config', icon: Settings, label: 'Config' },
            { id: 'logs', icon: Terminal, label: 'Logs' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-4 py-3 mb-2">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-slate-700" alt="" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={logOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <InstallButton />
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header>
                <h2 className="text-3xl font-bold text-white">Dashboard Overview</h2>
                <p className="text-slate-400">Quick stats and system status.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                  icon={Users} 
                  label="Total Users" 
                  value={users.length} 
                  color="indigo" 
                />
                <StatCard 
                  icon={Zap} 
                  label="Auto-Users" 
                  value={users.filter(u => u.role === 'autouser').length} 
                  color="cyan" 
                />
                <StatCard 
                  icon={Shield} 
                  label="VIP Users" 
                  value={users.filter(u => u.role === 'vip').length} 
                  color="purple" 
                />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-indigo-400" />
                  Recent Activity
                </h3>
                <div className="space-y-4">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex gap-4 p-4 bg-slate-950/50 rounded-2xl border border-slate-800/50">
                      <div className="p-2 bg-indigo-500/10 rounded-lg h-fit">
                        <Terminal className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <div className="text-sm text-slate-300" dangerouslySetInnerHTML={{ __html: log.message }} />
                        <p className="text-xs text-slate-500 mt-1">
                          {log.timestamp?.toDate().toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'users' && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-white">User Management</h2>
                  <p className="text-slate-400">Manage roles, expiry dates, and UIDs.</p>
                </div>
                <div className="relative">
                  <Search className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    placeholder="Search users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-12 pr-6 py-3 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-all w-80"
                  />
                </div>
              </header>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-800/50 text-slate-400 text-sm uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold">User</th>
                      <th className="px-6 py-4 font-semibold">Role</th>
                      <th className="px-6 py-4 font-semibold">UID</th>
                      <th className="px-6 py-4 font-semibold">Expiry</th>
                      <th className="px-6 py-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredUsers.map((u) => (
                      <UserRow key={u.id} user={u} />
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'config' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl space-y-8"
            >
              <header>
                <h2 className="text-3xl font-bold text-white">System Configuration</h2>
                <p className="text-slate-400">Update API endpoints and admin settings.</p>
              </header>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">API URL Template</label>
                  <div className="flex gap-3">
                    <input 
                      type="text" 
                      value={config.apiUrl}
                      onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
                      className="flex-1 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                      placeholder="https://api.example.com/like?uid={UID}"
                    />
                  </div>
                  <p className="text-xs text-slate-500">Use <code>{'{UID}'}</code> as a placeholder for the user's ID.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Admin Telegram ID</label>
                  <input 
                    type="text" 
                    value={config.adminTgId}
                    onChange={(e) => setConfig({ ...config, adminTgId: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                    placeholder="699315202994"
                  />
                </div>

                <button 
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'config', 'main'), { ...config });
                      alert('Config updated successfully!');
                    } catch (e) {
                      alert('Error updating config');
                    }
                  }}
                  className="w-full py-4 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Save Configuration
                </button>
              </div>
            </motion.div>
          )}

          {activeTab === 'logs' && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 flex flex-col h-full"
            >
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-white">System Logs</h2>
                  <p className="text-slate-400">Real-time activity from the Telegram bot.</p>
                </div>
                <button 
                  onClick={async () => {
                    if (confirm('Are you sure you want to clear all logs?')) {
                      // Implementation for clearing logs if needed
                    }
                  }}
                  className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-all text-sm font-medium flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Logs
                </button>
              </header>

              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl p-6 font-mono text-sm overflow-y-auto space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-4 p-3 hover:bg-slate-800/30 rounded-lg transition-colors group">
                    <span className="text-slate-600 shrink-0">
                      [{log.timestamp?.toDate().toLocaleTimeString()}]
                    </span>
                    <span className="text-indigo-400 shrink-0">INFO</span>
                    <span className="text-slate-300" dangerouslySetInnerHTML={{ __html: log.message }} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: any) {
  const colors: any = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };

  return (
    <div className={`p-6 rounded-3xl border ${colors[color]} bg-slate-900/50`}>
      <Icon className="w-8 h-8 mb-4" />
      <p className="text-slate-400 text-sm font-medium mb-1">{label}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

function UserRow({ user }: { user: UserData; key?: string }) {
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState(user);

  const handleSave = async () => {
    try {
      const { id, ...updateData } = data;
      await updateDoc(doc(db, 'users', id), updateData);
      setEditing(false);
    } catch (e) {
      alert('Error saving user');
    }
  };

  const handleDelete = async () => {
    if (confirm(`Are you sure you want to delete user ${user.name || user.tgId}?`)) {
      try {
        await deleteDoc(doc(db, 'users', user.id));
      } catch (e) {
        alert('Error deleting user');
      }
    }
  };

  return (
    <tr className="hover:bg-slate-800/30 transition-colors group">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-slate-400 font-bold">
            {(user.name || 'U')[0]}
          </div>
          <div>
            <p className="text-white font-medium">{user.name || 'Unknown'}</p>
            <p className="text-xs text-slate-500">TG: {user.tgId}</p>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        {editing ? (
          <select 
            value={data.role}
            onChange={(e) => setData({ ...data, role: e.target.value as any })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white"
          >
            <option value="normal">Normal</option>
            <option value="vip">VIP</option>
            <option value="autouser">Auto-User</option>
            <option value="admin">Admin</option>
          </select>
        ) : (
          <span className={`px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
            user.role === 'admin' ? 'bg-red-500/10 text-red-400' :
            user.role === 'vip' ? 'bg-purple-500/10 text-purple-400' :
            user.role === 'autouser' ? 'bg-cyan-500/10 text-cyan-400' :
            'bg-slate-700/50 text-slate-400'
          }`}>
            {user.role}
          </span>
        )}
      </td>
      <td className="px-6 py-4">
        {editing ? (
          <input 
            type="text" 
            value={data.uid || ''}
            onChange={(e) => setData({ ...data, uid: e.target.value })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white w-24 font-mono"
            placeholder="UID"
          />
        ) : (
          <span className="text-slate-400 font-mono text-sm">{user.uid || '-'}</span>
        )}
      </td>
      <td className="px-6 py-4">
        {editing ? (
          <input 
            type="date" 
            value={data.expiryDate?.split('T')[0] || ''}
            onChange={(e) => setData({ ...data, expiryDate: new Date(e.target.value).toISOString() })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white"
          />
        ) : (
          <span className="text-slate-500 text-sm">
            {user.expiryDate ? new Date(user.expiryDate).toLocaleDateString() : 'Never'}
          </span>
        )}
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {editing ? (
            <>
              <button onClick={handleSave} className="p-2 text-green-400 hover:bg-green-500/10 rounded-lg">
                <CheckCircle2 className="w-5 h-5" />
              </button>
              <button onClick={() => { setEditing(false); setData(user); }} className="p-2 text-slate-400 hover:bg-slate-500/10 rounded-lg">
                <AlertCircle className="w-5 h-5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="p-2 text-indigo-400 hover:bg-indigo-500/10 rounded-lg">
                <Settings className="w-5 h-5" />
              </button>
              <button onClick={handleDelete} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg">
                <Trash2 className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
