import { useNavigate } from 'react-router-dom';
import { Sun, Moon, LogOut, User, Menu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import GlobalSearch from './GlobalSearch';

interface TopBarProps {
  onMenuClick: () => void;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-14 flex-shrink-0 flex items-center gap-2 sm:gap-4 px-3 sm:px-6 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="md:hidden p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <GlobalSearch />

      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 ml-auto">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </button>

        {/* User info — hide label on very small screens */}
        <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-700">
          <User className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400 flex-shrink-0" />
          <span className="hidden sm:inline text-sm font-medium text-gray-700 dark:text-slate-200">
            {user?.username}
          </span>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
