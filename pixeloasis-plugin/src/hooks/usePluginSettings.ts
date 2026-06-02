import { useEffect, useState } from "react";

import type { PluginSettings } from "../domain/settings";
import { defaultPluginSettings } from "../domain/settings";
import {
  loadPluginSettings,
  savePluginSettings,
} from "../services/settings/pluginSettingsStore";

export function usePluginSettings() {
  const [settings, setSettings] = useState<PluginSettings>(defaultPluginSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Settings ready");

  useEffect(() => {
    let mounted = true;

    void loadPluginSettings()
      .then((loaded) => {
        if (!mounted) {
          return;
        }

        setSettings(loaded);
        setMessage("Settings loaded");
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        setMessage(
          error instanceof Error
            ? `Settings load failed: ${error.message}`
            : "Settings load failed",
        );
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  function updateField<K extends keyof PluginSettings>(
    field: K,
    value: PluginSettings[K],
  ) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function persist() {
    setSaving(true);
    setMessage("Saving settings...");

    try {
      const saved = await savePluginSettings(settings);
      setSettings(saved);
      setMessage("Settings saved");
      return saved;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Settings save failed: ${error.message}`
          : "Settings save failed",
      );
      throw error;
    } finally {
      setSaving(false);
    }
  }

  return {
    settings,
    loading,
    saving,
    message,
    updateField,
    persist,
  };
}
