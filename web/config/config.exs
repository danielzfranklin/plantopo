# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

# The session will be stored in the cookie and signed,
# this means its contents can be read but not tampered with.
# Set :encryption_salt if you would also like to encrypt it.
config :plantopo, :session_options,
  store: :cookie,
  key: "_plantopo_key",
  signing_salt: "2X9+N2Jc",
  same_site: "Lax"

config :plantopo,
  namespace: PlanTopo,
  ecto_repos: [PlanTopo.Repo]

config :plantopo, PlanTopo.Repo,
  migration_primary_key: [type: :binary_id],
  migration_timestamps: [type: :utc_datetime]

# Configures the endpoint
config :plantopo, PlanTopoWeb.Endpoint,
  http: [
    dispatch: [
      {:_,
       [
         {"/sync_socket", PlanTopoWeb.Sync.Socket, []},
         {:_, Plug.Cowboy.Handler, {PlanTopoWeb.Endpoint, []}}
       ]}
    ]
  ],
  url: [host: "localhost"],
  render_errors: [
    formats: [html: PlanTopoWeb.ErrorHTML, json: PlanTopoWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: PlanTopo.PubSub,
  live_view: [signing_salt: "DPF/hVzQ"]

# Configures the mailer
#
# By default it uses the "Local" adapter which stores the emails
# locally. You can see the emails in your browser, at "/dev/mailbox".
#
# For production it's recommended to configure a different adapter
# at the `config/runtime.exs`.
config :plantopo, PlanTopo.Mailer, adapter: Swoosh.Adapters.Local

# Configure esbuild (the version is required)
config :esbuild,
  version: "0.17.7",
  default: [
    args:
      ~w(js/app.js js/map.tsx --bundle --target=es2017 --jsx=automatic --jsx-dev --outdir=../priv/static/assets --external:/fonts/* --external:/images/*),
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => Path.expand("../deps", __DIR__)}
  ]

# Configure tailwind (the version is required)
config :tailwind,
  version: "3.2.4",
  default: [
    args: ~w(
      --config=tailwind.config.js
      --input=css/app.css
      --output=../priv/static/assets/app.css
    ),
    cd: Path.expand("../assets", __DIR__)
  ]

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
