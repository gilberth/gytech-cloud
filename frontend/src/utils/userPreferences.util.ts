const defaultPreferences = [
  {
    key: "colorScheme",
    value: "system",
  },
  {
    key: "locale",
    value: "system",
  },
];

const get = (key: string) => {
  if (typeof window !== "undefined") {
    try {
      const preferences = JSON.parse(localStorage.getItem("preferences") ?? "{}");
      return (
        preferences[key] ??
        defaultPreferences.find((p) => p.key == key)?.value ??
        null
      );
    } catch (error) {
      console.warn("Error accessing localStorage:", error);
      return defaultPreferences.find((p) => p.key == key)?.value ?? null;
    }
  }
  // Return default value when window is not available (SSR)
  return defaultPreferences.find((p) => p.key == key)?.value ?? null;
};

const set = (key: string, value: string) => {
  if (typeof window !== "undefined") {
    try {
      const preferences = JSON.parse(localStorage.getItem("preferences") ?? "{}");
      preferences[key] = value;
      localStorage.setItem("preferences", JSON.stringify(preferences));
    } catch (error) {
      console.warn("Error setting localStorage:", error);
    }
  }
};
const userPreferences = {
  get,
  set,
};

export default userPreferences;
