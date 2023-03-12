defmodule PlanTopoWeb.Sync.Socket do
  @behaviour :cowboy_websocket
  require Logger
  alias PlanTopo.{Sync, Accounts, Maps}
  require OpenTelemetry.Tracer, as: Tracer

  @session_options Application.compile_env!(:plantopo, :session_options)
  @session_signing_salt Keyword.fetch!(@session_options, :signing_salt)
  @session_key Keyword.fetch!(@session_options, :key)

  @impl :cowboy_websocket
  def init(req, _opts) do
    map = req.qs
    peer = get_peer(req)
    user = get_user_or_nil(req)
    role = Maps.role(user, map)

    if role in [:viewer, :editor, :owner] do
      user_id = if(!is_nil(user), do: user.id)
      fallback_center = Maps.lookup_fallback_center(peer)

      {:cowboy_websocket, req,
       [
         map: map,
         meta: %{user: user_id, role: role},
         fallback_center: fallback_center,
         peer: peer
       ]}
    else
      req = :cowboy_req.reply(403, %{"content-type" => "text/plain"}, "Forbidden", req)
      {:ok, req, nil}
    end
  end

  @impl :cowboy_websocket
  def websocket_init(opts) do
    Tracer.with_span "sync socket init" do
      map = Keyword.fetch!(opts, :map)
      meta = Keyword.fetch!(opts, :meta)
      fallback_center = Keyword.fetch!(opts, :fallback_center)
      peer = Keyword.fetch!(opts, :peer)

      Tracer.set_attributes(%{
        map: map,
        user: meta.user,
        role: meta.role,
        peer: inspect(peer),
        fallback_center: fallback_center
      })

      engine = Sync.connect!(map, meta, fallback_center, Tracer.current_span_ctx())
      Process.monitor(engine)

      {:ok, engine}
    end
  end

  @impl :cowboy_websocket
  def websocket_handle({:ping, _}, engine), do: {:reply, :pong, engine}

  @impl :cowboy_websocket
  def websocket_handle({:binary, msg}, engine) do
    Tracer.with_span "sync socket handle binary" do
      Sync.handle_recv!(engine, msg, Tracer.current_span_ctx())
      {:ok, engine}
    end
  end

  @impl true
  def websocket_info({:send, msg}, engine) do
    {:reply, {:binary, msg}, engine}
  end

  @impl true
  def websocket_info({:DOWN, _, _, pid2, reason}, engine) do
    if pid2 == engine do
      Logger.warn("Stopping socket as engine died: #{inspect(reason)}")
      {:stop, engine}
    else
      {:noreply, engine}
    end
  end

  defp get_peer(req) do
    # Note: The ip we get here is potentially forged. We only use it for the initial center position
    with header when not is_nil(header) <- Map.get(req.headers, "x-forwarded-for") do
      RemoteIp.from([{"x-forwarded-for", header}])
    else
      nil -> elem(req.peer, 0)
    end
  end

  defp get_user_or_nil(req) do
    with {:ok, cookie} <- Map.fetch(req.headers, "cookie"),
         cookie <- Plug.Conn.Cookies.decode(cookie),
         {:ok, session_cookie} <- Map.fetch(cookie, @session_key),
         session = verify_session!(session_cookie),
         {:ok, token} <- Map.fetch(session, "user_token") do
      Accounts.get_user_by_session_token(token)
    else
      _ -> nil
    end
  end

  defp verify_session!(cookie) do
    alias Plug.Crypto

    key_opts = [iterations: 1000, length: 32, digest: :sha256, cache: Plug.Keys]

    secret_key_base =
      Application.fetch_env!(:plantopo, PlanTopoWeb.Endpoint) |> Keyword.fetch!(:secret_key_base)

    secret = Crypto.KeyGenerator.generate(secret_key_base, @session_signing_salt, key_opts)

    {:ok, term} = Crypto.MessageVerifier.verify(cookie, secret)
    Crypto.non_executable_binary_to_term(term)
  end
end
