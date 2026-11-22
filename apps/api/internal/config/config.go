// Package config reads the API's settings from the environment. Secrets live in
// /etc/portfolio-api/env on the host and never in the repository.
package config

import (
	"fmt"
	"os"
	"strings"
)

type OAuthApp struct{ ID, Secret string }

type Config struct {
	Listen        string
	DBPath        string
	SessionSecret []byte
	AdminUser     string
	AdminHash     string // bcrypt
	GitHubToken   string // fine-grained, Contents read/write on the content repo
	GitHubRepo    string
	GitHubBranch  string
	AuthLog       string
	OAuth         map[string]OAuthApp // github, google, linkedin
	Dev           bool                // allow http://localhost origins and insecure cookies
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func Load() (*Config, error) {
	c := &Config{
		Listen:       env("LISTEN", "127.0.0.1:8787"),
		DBPath:       env("DB_PATH", "/var/lib/portfolio-api/portfolio.db"),
		AdminUser:    env("ADMIN_USER", ""),
		AdminHash:    env("ADMIN_PASS_HASH", ""),
		GitHubToken:  env("GITHUB_CONTENT_TOKEN", ""),
		GitHubRepo:   env("GITHUB_REPO", "SHIVAM-SHARMA-766/portfolio"),
		GitHubBranch: env("GITHUB_BRANCH", "main"),
		AuthLog:      env("AUTH_LOG", ""),
		Dev:          env("DEV", "") == "1",
		OAuth:        map[string]OAuthApp{},
	}
	secret := env("SESSION_SECRET", "")
	if len(secret) < 32 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 32 characters")
	}
	c.SessionSecret = []byte(secret)
	for _, p := range []string{"github", "google", "linkedin"} {
		up := strings.ToUpper(p)
		id, sec := env("OAUTH_"+up+"_ID", ""), env("OAUTH_"+up+"_SECRET", "")
		if id != "" && sec != "" {
			c.OAuth[p] = OAuthApp{ID: id, Secret: sec}
		}
	}
	return c, nil
}
