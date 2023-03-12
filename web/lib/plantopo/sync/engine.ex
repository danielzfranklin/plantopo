defmodule PlanTopo.Sync.Engine do
  @moduledoc """
  Manages the synchronization of a single map
  """
  use GenServer, restart: :temporary
  alias PlanTopo.Maps.ViewAt
  alias PlanTopo.Maps
  import PlanTopo.Sync.EngineNative
  require Logger
  require OpenTelemetry.Tracer, as: Tracer

  @initial_view_at_tag 10
  @save_every_millis 1000 * 30
  @timeout_millis 1000 * 60

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)
    link = Keyword.fetch!(opts, :init_parent_span) |> OpenTelemetry.link()

    Tracer.with_span "engine init", %{links: [link]} do
      map = Keyword.fetch!(opts, :map)
      Tracer.set_attribute("map", map)

      state =
        %{
          map: map,
          aware: awareness_new(),
          sockets: Map.new(),
          user_view_ats: Map.new(),
          last_recv: DateTime.utc_now()
        }
        |> bump_timeout()

      saved_update = Maps.get_autosave_as_update(map)
      Tracer.add_event("loaded last snapshot", is_nil: is_nil(saved_update))

      case saved_update do
        nil ->
          Logger.info("Created engine [map=#{inspect(map)}] from blank")

        saved_update ->
          Tracer.with_span "apply snapshot" do
            {:ok, _update} = apply_update(state.aware, saved_update)
            Logger.info("Created engine [map=#{inspect(map)}] from snapshot")
          end
      end

      Process.send_after(self(), :snapshot, @save_every_millis)

      {:ok, state}
    end
  end

  @impl true
  def terminate(reason, state) do
    Tracer.with_span "engine terminate", %{attributes: [{"reason", reason}]} do
      if reason != :normal do
        Logger.warn("Sync engine terminating abnormally: #{inspect(reason)}")
      end

      save_state(state, false)

      reason
    end
  end

  @impl true
  def handle_call(
        {:connect, %{meta: meta, fallback_center: fallback_center}, parent},
        {caller, _},
        state
      ) do
    if Map.has_key?(state.sockets, caller) do
      {:reply, {:error, :already_connected}, state}
    else
      link = OpenTelemetry.link(parent)

      Tracer.with_span "engine connect", %{links: [link]} do
        state = %{state | sockets: Map.put(state.sockets, caller, meta)}
        Process.monitor(caller)

        enc = message_encoder_new()

        case meta.user do
          nil ->
            Tracer.add_event("made fallback view at", [])
            view_at = Maps.make_fallback_view_at(nil, state.map, fallback_center)
            :ok = message_encoder_write(enc, initial_view_at_msg(view_at))

          user_id ->
            case Map.get(state.user_view_ats, user_id) do
              nil ->
                run_task(fn ->
                  view_at = Maps.get_view_at(user_id, state.map)

                  if not is_nil(view_at) do
                    Logger.debug("Got view at from db")
                    {:ok, msg} = message_encode(initial_view_at_msg(view_at))
                    send(caller, {:send, msg})
                  else
                    Logger.debug("Got no view at in db, making fallback")
                    view_at = Maps.make_fallback_view_at(nil, state.map, fallback_center)
                    {:ok, msg} = message_encode(initial_view_at_msg(view_at))
                    send(caller, {:send, msg})
                  end
                end)

              value ->
                Logger.debug("got view at from state")
                :ok = message_encoder_write(enc, initial_view_at_msg(value))
            end
        end

        :ok = encode_intro(state.aware, enc)
        {:ok, msg} = message_encoder_finish(enc)
        send(caller, {:send, msg})

        Logger.info("Connected #{inspect(caller)} to #{state.map} as #{inspect(meta)}")

        {:reply, :ok, bump_timeout(state)}
      end
    end
  end

  @impl true
  def handle_call({:recv, messages, parent}, {caller, _}, state) do
    link = OpenTelemetry.link(parent)

    Tracer.with_span "engine recv", %{links: [link]} do
      case Map.fetch(state.sockets, caller) do
        {:ok, meta} ->
          Enum.reduce_while(messages, {:ok, state}, fn msg, {:ok, state} ->
            Tracer.with_span "process_msg", %{
              attributes: [{"msg_type", elem(msg, 0)}, {"meta", meta}]
            } do
              case process_msg(state, meta, caller, msg) do
                {:ok, state} ->
                  {:cont, {:ok, state}}

                {:error, error, state} ->
                  Tracer.add_event("error", error: error)
                  {:error, {:error, error, state}}
              end
            end
          end)
          |> case do
            {:ok, state} -> {:reply, :ok, bump_timeout(state)}
            {:error, error, state} -> {:reply, {:error, error}, bump_timeout(state)}
          end

        :error ->
          {:reply, {:error, :not_connected}, state}
      end
    end
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, caller, _reason}, state) do
    if Map.has_key?(state.sockets, caller) do
      state = Map.update!(state, :sockets, &Map.delete(&1, caller))
      Logger.info("Disconnected #{inspect(caller)} from #{state.map}")
      {:noreply, state}
    else
      {:noreply, state}
    end
  end

  @impl true
  def handle_info({:EXIT, _pid, _reason}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(:timeout, state) do
    Tracer.with_span "engine timeout check", %{attributes: [{"sockets", state.sockets}]} do
      if map_size(state.sockets) == 0 do
        Tracer.add_event("stopping", [])
        Logger.info("Stopping engine for #{state.map} as no connected sockets for timeout")
        {:stop, :normal, state}
      else
        Tracer.add_event("not stopping", [])
        {:noreply, state}
      end
    end
  end

  @impl true
  def handle_info(:snapshot, state) do
    save_state(state, true)
    {:noreply, state}
  end

  @impl true
  def handle_info({ref, :task_ok}, state) when is_reference(ref) do
    {:noreply, state}
  end

  @impl true
  def handle_info({ref, {:error, err}}, state) when is_reference(ref) do
    Logger.error("Async task failed: #{inspect(err)}")
    {:stop, err, state}
  end

  defp process_msg(state, meta, caller, msg) do
    aware = state.aware

    case msg do
      {:sync_step1, sv} ->
        {:ok, update} = encode_state_as_update(aware, sv)
        {:ok, reply} = message_encode({:sync_step2, update})
        send(caller, {:send, reply})
        {:ok, state}

      {:sync_step2, update} ->
        if meta.role == :editor || meta.role == :owner do
          {:ok, update} = apply_update(aware, update)
          {:ok, bcast} = message_encode({:sync_update, update})
          broadcast(state, bcast)
          {:ok, state}
        else
          {:error, :permission_denied, state}
        end

      {:sync_update, update} ->
        if meta.role == :editor || meta.role == :owner do
          {:ok, update} = apply_update(aware, update)
          {:ok, bcast} = message_encode({:sync_update, update})
          broadcast(state, bcast)
          {:ok, state}
        else
          {{:error, :permission_denied}, state}
        end

      {:awareness_query, nil} ->
        {:ok, update} = encode_awareness_update(aware)
        {:ok, reply} = message_encode({:awareness_update, update})
        send(caller, {:send, reply})
        {:ok, state}

      {:awareness_update, update} ->
        state =
          with {:ok, user_id} <- Map.fetch(meta, :user),
               {:ok, update_map} <- awareness_update_to_map(update),
               [{_client, {_clock, json}}] <- Map.to_list(update_map),
               {:ok, json} when is_map(json) <- Jason.decode(json),
               {:ok, view_at} <- Map.fetch(json, "viewAt"),
               %{
                 "center" => [center_lng, center_lat],
                 "zoom" => zoom,
                 "pitch" => pitch,
                 "bearing" => bearing
               } <- view_at,
               %Ecto.Changeset{valid?: true, changes: view_at} <-
                 ViewAt.value_changeset(%{
                   center_lng: center_lng,
                   center_lat: center_lat,
                   zoom: zoom,
                   pitch: pitch,
                   bearing: bearing
                 }) do
            %{state | user_view_ats: Map.put(state.user_view_ats, user_id, view_at)}
          else
            _ ->
              state
          end

        :ok = apply_awareness_update(aware, update)
        {:ok, bcast} = message_encode({:awareness_update, update})
        broadcast(state, bcast)
        {:ok, state}

      msg ->
        Logger.debug("Unhandled msg: #{inspect(msg)}")
        {:ok, state}
    end
  end

  defp bump_timeout(state) do
    Map.update(state, :timeout_timer, nil, fn old ->
      if old do
        _ = Process.cancel_timer(old)
        nil
      end

      Process.send_after(self(), :timeout, @timeout_millis)
    end)
  end

  defp broadcast(state, data) do
    Map.keys(state.sockets)
    |> Enum.each(fn peer -> send(peer, {:send, data}) end)
  end

  defp initial_view_at_msg(value) do
    json =
      Jason.encode!(%{
        center: [value.center_lng, value.center_lat],
        zoom: value.zoom,
        pitch: value.pitch,
        bearing: value.bearing
      })

    {:custom, @initial_view_at_tag, json}
  end

  defp save_state(state, async?) do
    Tracer.with_span "save_state", %{attributes: [{"async", async?}]} do
      aware = state.aware
      map_id = state.map

      prev_save_snapshot = Maps.get_autosave_snapshot(map_id)

      # Note that we can't lock aware asyncronously
      map_task =
        case serialize_snapshot_if_changed(aware, prev_save_snapshot) do
          {:error, error} ->
            Logger.error("Failed to snapshot state: #{inspect(error)}")
            nil

          {:ok, nil} ->
            nil

          {:ok, snapshot} ->
            {:ok, as_update} = encode_state_as_update(aware, nil)
            {:ok, data} = serialize_data(aware)

            attrs = %{
              map_id: map_id,
              snapshot: snapshot,
              as_update: as_update,
              data: data,
              saved_at: DateTime.utc_now()
            }

            run_task(fn ->
              attrs = Map.update!(attrs, :data, &Jason.decode!/1)
              {:ok, _} = Maps.autosave(attrs)
            end)
        end

      view_at_tasks =
        for {user_id, view_at} <- state.user_view_ats do
          run_task(fn ->
            {:ok, _} = Maps.update_view_at(user_id, map_id, view_at)
          end)
        end

      if !async? do
        [map_task | view_at_tasks]
        |> Enum.filter(&(!is_nil(&1)))
        |> Task.await_many()
      end
    end
  end

  defp run_task(fun) do
    _ =
      Task.Supervisor.async(PlanTopo.TaskSupervisor, fn ->
        fun.()
        :task_ok
      end)

    nil
  end
end
