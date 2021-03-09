import { Song, marshaledSong } from '@/models/songs'

import { Album } from '../../models/albums'
import { DBUtils } from './utils'
import { Genre } from '@/models/genre'
import { Playlist } from '../../models/playlists'
import { SearchResult } from '../../models/searchResult'
import { artists } from '@/models/artists'
import { v4 } from 'uuid'

class SongDBInstance extends DBUtils {
  private getMetaCommon(
    term: string | undefined,
    tableName: string,
    bridgeTable: string,
    rowName: string,
    exclude?: string[]
  ) {
    return this.db.query(
      `SELECT * FROM ${tableName}
      INNER JOIN ${bridgeTable} ON ${tableName}.${rowName}_id = ${bridgeTable}.${rowName}
      INNER JOIN allsongs ON ${bridgeTable}.song = allsongs._id
      ${this.addExcludeWhereClause(true, exclude)}
      ${term ? `WHERE ${tableName}.${rowName}_name LIKE ?` : ''} GROUP BY ${tableName}.${rowName}_id`,
      `%${term}%`
    )
  }
  /* ============================= 
                ALLSONGS
     ============================= */

  public async getAllSongs(exclude?: string[]): Promise<Song[]> {
    let marshaled: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM allsongs
      ${this.addLeftJoinClause(undefined, 'allsongs')}
      ${this.addExcludeWhereClause(true, exclude)} GROUP BY allsongs._id`
    )
    return this.batchUnmarshal(marshaled)
  }

  public async store(newDoc: Song): Promise<void> {
    let artistID = newDoc.artists ? this.storeArtists(...newDoc.artists) : []
    let albumID = newDoc.album ? this.storeAlbum(newDoc.album) : ''
    let genreID = this.storeGenre(newDoc.genre)
    let marshaledSong = this.marshalSong(newDoc)
    this.db.insert('allsongs', marshaledSong)
    this.storeArtistBridge(artistID, marshaledSong._id)
    this.storeGenreBridge(genreID, marshaledSong._id)
    this.storeAlbumBridge(albumID, marshaledSong._id)
    return
  }

  public async removeSong(song_id: string) {
    this.db.transaction((song_id: string) => {
      this.db.delete('artists_bridge', { song: song_id })
      this.db.delete('album_bridge', { song: song_id })
      this.db.delete('genre_bridge', { song: song_id })
      this.db.delete('playlist_bridge', { song: song_id })
      this.db.delete('allsongs', { _id: song_id })
    })(song_id)
  }

  public async searchSongsCompact(term: string, exclude?: string[]): Promise<SearchResult> {
    let songs: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM allsongs 
      ${this.addLeftJoinClause(undefined, 'allsongs')}
        WHERE allsongs.path LIKE ? 
        OR albums.album_name LIKE ?
        OR artists.artist_name LIKE ?
        ${this.addExcludeWhereClause(false, exclude)} GROUP BY allsongs._id`,
      `%${term}%`,
      `%${term}%`,
      `%${term}%`
    )
    return { songs: this.batchUnmarshal(songs) }
  }

  public async searchAll(term: string, exclude?: string[]): Promise<SearchResult> {
    let songs: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM allsongs 
      ${this.addLeftJoinClause(undefined, 'allsongs')} 
      WHERE allsongs.path LIKE ? ${this.addExcludeWhereClause(false, exclude)} 
      GROUP BY allsongs._id`,
      `%${term}%`
    )
    let albums: Album[] = this.getMetaCommon(term, 'albums', 'album_bridge', 'album', exclude) as Album[]
    let artists: artists[] = this.getMetaCommon(term, 'artists', 'artists_bridge', 'artist', exclude) as artists[]
    let genre: Genre[] = this.getMetaCommon(term, 'genre', 'genre_bridge', 'genre', exclude) as Genre[]

    return { songs: this.batchUnmarshal(songs), albums: albums, artists: artists, genres: genre }
  }

  public async countByHash(hash: string): Promise<number> {
    return new Promise((resolve) => {
      resolve(this.db.queryFirstCell(`SELECT COUNT(*) FROM allsongs WHERE hash = ?`, hash)!)
    })
  }

  public async getBySize(size: string): Promise<{ _id: string }[]> {
    return new Promise((resolve) => {
      resolve(this.db.query(`SELECT _id FROM allsongs WHERE size = ?`, size))
    })
  }

  public async getInfoByID(id: string): Promise<{ path: string; inode: string; deviceno: string }[]> {
    return this.db.query(`SELECT path, inode, deviceno FROM allsongs WHERE _id = ?`, id)
  }

  /* ============================= 
                ALBUMS
     ============================= */

  public async getAllAlbums(exclude?: string[]): Promise<Album[]> {
    return this.db.query(
      `SELECT * from albums A
        INNER JOIN album_bridge B ON A.album_id = B.album
        INNER JOIN allsongs C ON B.song = C._id
        ${this.addExcludeWhereClause(true, exclude)}
        GROUP BY A.album_id`
    )
  }

  public async getAlbumSongs(id: string, exclude?: string[]): Promise<Song[]> {
    let marshaled: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM album_bridge
      ${this.addLeftJoinClause('album_bridge', 'album')} 
      WHERE album_bridge.album = ? 
      ${this.addExcludeWhereClause(false, exclude)} GROUP BY allsongs._id`,
      id
    )
    return this.batchUnmarshal(marshaled)
  }

  private storeAlbum(album: Album): string {
    let id: string | undefined
    if (album.album_name) {
      id = this.db.queryFirstCell(
        `SELECT album_id FROM albums WHERE album_name = ? COLLATE NOCASE`,
        album.album_name.trim()
      )
      if (!id) {
        id = v4()
        this.db.insert('albums', {
          album_id: id,
          album_name: album.album_name.trim(),
          album_coverPath: album.album_coverPath,
          year: album.year,
        })
      }
    }
    return id as string
  }

  public updateSongCountAlbum() {
    this.db.transaction(() => {
      for (let row of this.db.query(`SELECT album_id FROM albums`)) {
        this.db.run(
          `UPDATE albums SET album_song_count = (SELECT count(id) FROM album_bridge WHERE album = ?) WHERE album_id = ?`,
          (row as Album).album_id,
          (row as Album).album_id
        )
      }
    })()
  }

  private storeAlbumBridge(albumID: string, songID: string) {
    if (albumID) this.db.insert('album_bridge', { song: songID, album: albumID })
  }

  /* ============================= 
                GENRE
     ============================= */

  public async getAllGenres(exclude?: string[]): Promise<Genre[]> {
    return this.db.query(
      `SELECT * from genre A
        INNER JOIN genre_bridge B ON A.genre_id = B.genre
        INNER JOIN allsongs C ON B.song = C._id
        ${this.addExcludeWhereClause(true, exclude)}
        GROUP BY A.genre_id`
    )
  }

  public async getGenreSongs(id: string, exclude?: string[]) {
    let marshaled: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM genre_bridge 
      ${this.addLeftJoinClause('genre_bridge', 'genre')}
      WHERE genre_bridge.genre = ? 
      ${this.addExcludeWhereClause(false, exclude)} GROUP BY allsongs._id`,
      id
    )
    return this.batchUnmarshal(marshaled)
  }

  public updateSongCountGenre() {
    this.db.transaction(() => {
      for (let row of this.db.query(`SELECT genre_id FROM genre`)) {
        this.db.run(
          `UPDATE genre SET genre_song_count = (SELECT count(id) FROM genre_bridge WHERE genre = ?) WHERE genre_id = ?`,
          (row as Genre).genre_id,
          (row as Genre).genre_id
        )
      }
    })()
  }

  private storeGenre(genre?: string[]) {
    let genreID: string[] = []
    if (genre) {
      for (let a of genre) {
        let id = this.db.queryFirstCell(`SELECT genre_id FROM genre WHERE genre_name = ? COLLATE NOCASE`, a)
        if (id) genreID.push(id)
        else {
          let id = v4()
          this.db.insert('genre', { genre_id: id, genre_name: a })
          genreID.push(id)
        }
      }
    }
    return genreID
  }

  private storeGenreBridge(genreID: string[], songID: string) {
    for (let i of genreID) {
      this.db.insert('genre_bridge', { song: songID, genre: i })
    }
  }

  public async getGenres() {
    return this.db.query(`SELECT * FROM genre`)
  }

  /* ============================= 
                ARTISTS
     ============================= */

  public async getAllArtists(exclude?: string[]): Promise<artists[]> {
    return this.db.query(
      `SELECT * FROM artists A
        INNER JOIN artists_bridge B ON A.artist_id = B.artist
        INNER JOIN allsongs C ON B.song = C._id
        ${this.addExcludeWhereClause(true, exclude)}
        GROUP BY A.artist_id`
    )
  }

  public async getArtistSongs(id: string, exclude?: string[]): Promise<Song[]> {
    let marshaled: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM artists_bridge 
      ${this.addLeftJoinClause('artists_bridge', 'artists')}  
      WHERE artists_bridge.artist = ? 
      ${this.addExcludeWhereClause(false, exclude)} GROUP BY allsongs._id`,
      id
    )
    return this.batchUnmarshal(marshaled)
  }

  public async updateArtists(artist: artists) {
    return new Promise((resolve) => {
      resolve(
        this.db.updateWithBlackList(
          'artists',
          artist,
          ['artist_id = ?', artist.artist_id],
          ['artist_id', 'artist_name']
        )
      )
    })
  }

  private storeArtists(...artists: string[]): string[] {
    let artistID: string[] = []
    for (let a of artists) {
      let id = this.db.queryFirstCell(`SELECT artist_id FROM artists WHERE artist_name = ? COLLATE NOCASE`, a.trim())
      if (id) artistID.push(id)
      else {
        let id = v4()
        this.db.insert('artists', { artist_id: id, artist_name: a.trim() })
        artistID.push(id)
      }
    }
    return artistID
  }

  private storeArtistBridge(artistID: string[], songID: string) {
    for (let i of artistID) {
      this.db.insert('artists_bridge', { song: songID, artist: i })
    }
  }

  public async getDefaultCoverByArtist(id: string): Promise<string | undefined> {
    return (this.db.queryFirstRow(
      `SELECT album_coverPath from albums WHERE album_id = (SELECT album FROM album_bridge WHERE song = (SELECT song FROM artists_bridge WHERE artist = ?))`,
      id
    ) as marshaledSong).album_coverPath
  }

  public updateSongCountArtists() {
    this.db.transaction(() => {
      for (let row of this.db.query(`SELECT artist_id FROM artists`)) {
        this.db.run(
          `UPDATE artists SET artist_song_count = (SELECT count(id) FROM artists_bridge WHERE artist = ?) WHERE artist_id = ?`,
          (row as artists).artist_id,
          (row as artists).artist_id
        )
      }
    })()
  }

  /* ============================= 
                PLAYLISTS
     ============================= */

  public async getPlaylistSongs(id: string, exclude?: string[]) {
    let marshaled: marshaledSong[] = this.db.query(
      `SELECT *, ${this.addGroupConcatClause()} FROM playlist_bridge 
      ${this.addLeftJoinClause('playlist_bridge')} 
      WHERE playlist_bridge.playlist = ? 
      ${this.addExcludeWhereClause(false, exclude)} GROUP BY allsongs._id`,
      id
    )
    return this.batchUnmarshal(marshaled)
  }

  public async getPlaylists(): Promise<Playlist[]> {
    return this.db.query(`SELECT * FROM playlists`)
  }

  public async createPlaylist(name: string): Promise<string> {
    const id = v4()
    this.db.insert('playlists', { playlist_id: id, playlist_name: name })
    return id
  }

  public updatePlaylistCoverPath(playlist_id: string, coverPath: string) {
    this.db.update('playlists', { playlist_coverPath: coverPath }, ['playlist_id = ?', playlist_id])
  }

  private isPlaylistCoverExists(playlist_id: string) {
    return (
      (this.db.query(`SELECT playlist_coverPath FROM playlists WHERE playlist_id = ?`, playlist_id)[0] as Playlist)
        .playlist_coverPath !== null
    )
  }

  public async addToPlaylist(playlist_id: string, ...songs: Song[]) {
    let coverExists = this.isPlaylistCoverExists(playlist_id)
    this.db.transaction((songs: Song[]) => {
      for (let s of songs) {
        if (!coverExists) {
          if (s.album && s.album.album_coverPath) {
            this.updatePlaylistCoverPath(playlist_id, s.album.album_coverPath)
          }
        }
        this.db.insert('playlist_bridge', { playlist: playlist_id, song: s._id })
      }
    })(songs)
    this.updateSongCountPlaylists()
  }

  public async removeFromPlaylist(playlist: string, ...songs: string[]) {
    this.db.transaction((songs: string[]) => {
      for (let s in songs) {
        this.db.delete('playlist_bridge', { playlist: playlist, song: s })
      }
    })(songs)
    this.updateSongCountPlaylists()
  }

  public updateSongCountPlaylists() {
    this.db.transaction(() => {
      for (let row of this.db.query(`SELECT playlist_id FROM playlists`)) {
        this.db.run(
          `UPDATE playlists SET playlist_song_count = (SELECT count(id) FROM playlist_bridge WHERE playlist = ?) WHERE playlist_id = ?`,
          (row as Playlist).playlist_id,
          (row as Playlist).playlist_id
        )
      }
    })()
  }
}

export const SongDB = new SongDBInstance()
