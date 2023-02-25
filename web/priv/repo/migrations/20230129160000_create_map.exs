defmodule PlanTopo.Repo.Migrations.CreateMapSourceData do
  use Ecto.Migration

  def change do
    create table(:map_layer_datas, primary_key: false) do
      add :id, :string, primary_key: true
      add :spec, :map
      add :attribution, :string

      timestamps()
    end

    create table(:map_layer_sources) do
      add :name, :string
      add :default_opacity, :float
      add :layer_specs, {:array, :map}
      add :glyphs, :string
      add :sprite, :string

      timestamps()
    end

    create table(:map_layer_source_dependencies, primary_key: false) do
      add :source_id, references(:map_layer_sources, on_delete: :delete_all), primary_key: true

      add :data_id, references(:map_layer_datas, on_delete: :delete_all, type: :string),
        primary_key: true
    end

    create table(:maps) do
      add :name, :string
      timestamps()
    end

    create table(:map_snapshots) do
      add :map_id, references(:maps, on_delete: :delete_all)
      add :state, :binary
      add :data, :jsonb
      add :snapshot_at, :naive_datetime
      add :after_error, :string
    end

    create index(:map_snapshots, [:map_id])

    create table(:map_view_ats, primary_key: false) do
      add :user_id, references(:users, on_delete: :delete_all), primary_key: true
      add :map_id, references(:maps, on_delete: :delete_all), primary_key: true

      add :center, {:array, :float}
      add :zoom, :float
      add :pitch, :float
      add :bearing, :float

      timestamps()
    end

    execute(
      "CREATE TYPE map_role AS ENUM ('viewer', 'editor', 'owner')",
      "DROP TYPE map_role"
    )

    create table(:map_roles, primary_key: false) do
      add :user_id, references(:users, on_delete: :delete_all), primary_key: true
      add :map_id, references(:maps, on_delete: :delete_all), primary_key: true
      add :value, :map_role
      timestamps()
    end
  end
end
