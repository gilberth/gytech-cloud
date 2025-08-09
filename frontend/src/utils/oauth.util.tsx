import * as SiIcons from "react-icons/si";
import React from "react";
import api from "../services/api.service";

const getOAuthUrl = (appUrl: string, provider: string) => {
  return `${appUrl}/api/oauth/auth/${provider}`;
};

const getOAuthIcon = (provider: string) => {
  return {
    google: <SiIcons.SiGoogle />,
    microsoft: <SiIcons.SiMicrosoft />,
    github: <SiIcons.SiGithub />,
    discord: <SiIcons.SiDiscord />,
    oidc: <SiIcons.SiOpenid />,
  }[provider];
};

const unlinkOAuth = (provider: string) => {
  return api.post(`/oauth/unlink/${provider}`);
};

export { getOAuthUrl, getOAuthIcon, unlinkOAuth };
