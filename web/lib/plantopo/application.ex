defmodule PlanTopo.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    children =
      [
        # Start the Telemetry supervisor
        PlanTopoWeb.Telemetry,
        # Start the Ecto repository
        PlanTopo.Repo,
        # Start the PubSub system
        {Phoenix.PubSub, name: PlanTopo.PubSub},
        # Start Finch
        {Finch, name: PlanTopo.Finch},
        PlanTopo.Sync.Manager,
        # Start the Endpoint (http/https)
        PlanTopoWeb.Endpoint,
        if(Application.get_env(:plantopo, :start_minio),
          do: {MinioServer, Application.get_env(:plantopo, :minio_server)}
        )
      ]
      |> Enum.filter(&(!is_nil(&1)))

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: PlanTopo.Supervisor]
    {:ok, sup_pid} = Supervisor.start_link(children, opts)

    :locus.start_loader(:city, {:maxmind, "GeoLite2-City"})

    {:ok, sup_pid}
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    PlanTopoWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
