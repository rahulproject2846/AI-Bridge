"use client";

import { ConfigProvider, App as AntdApp, theme } from "antd";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Mode = "light" | "dark";
const ThemeModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({
  mode: "light",
  setMode: () => {},
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem("themeMode");
    return saved === "dark" ? "dark" : "light";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("themeMode", mode);
  }, [mode]);
  const algorithm = useMemo(
    () => (mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm),
    [mode]
  );
  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <ConfigProvider theme={{ algorithm }}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}
