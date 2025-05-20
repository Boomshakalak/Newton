import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import fs from "fs";
import path from "path";
import pify from "pify";
import range from "lodash/range";
import AddDir from "./AddDir";
import AddFile from "./AddFile";
import Draggable from "./Draggable";
import FileLine from "./FileLine";
import Pathname from "./Pathname";
import HoverMenu from "./HoverMenu";
import { List, ListItem, ListItemText, ListItemIcon } from "@mui/material";
import {
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";
import FileIcon from "@mui/icons-material/InsertDriveFile";
import { Box, TextField } from "@mui/material";

import { readFileStats, getProjectInfo } from "domain/filesystem";
import { useFileStore } from "store";
import ArIcon from "@/components/arIcon";
import ContextMenu from "@/components/contextMenu";
import { toast } from "react-toastify";

const LinkedLines = ({
  dirpath,
  root,
  depth,
  fileList,
  editingFilepath,
  lastSelectedIndex,
  setLastSelectedIndex,
  setSelectedFilesRange,
  ...res
}) => {
  // Build a flat list of file paths for range selection
  const flatFileList = fileList.filter(f => f.type === "file").map(f => path.join(dirpath, f.name));
  return (
    <>
      {fileList.map((f) => {
        const filepath = path.join(dirpath, f.name);
        if (f.type === "file") {
          return (
            <FileLine
              {...res}
              key={f.name}
              depth={depth}
              filepath={filepath}
              ignoreGit={f.ignored}
              fileList={flatFileList}
              lastSelectedIndex={lastSelectedIndex}
              setLastSelectedIndex={setLastSelectedIndex}
              setSelectedFilesRange={setSelectedFilesRange}
            />
          );
        } else if (f.type === "dir") {
          if (f.name === ".git") return null;
          return (
            <DirectoryLine
              {...res}
              key={f.name}
              root={root}
              dirpath={filepath}
              depth={depth}
              open={
                editingFilepath != null &&
                !path.relative(filepath, editingFilepath).startsWith("..")
              }
              ignoreGit={f.ignored}
            />
          );
        }
        return null;
      })}
    </>
  );
};

const DirectoryLineContent = ({
  dirpath,
  depth,
  root,
  open = false,
  touchCounter,
  isFileCreating,
  isDirCreating,
  fileMoved,
  startFileCreating,
  startDirCreating,
  deleteDirectory,
  editingFilepath,
  ignoreGit: p_ignoreGit,
  loadFile,
  currentSelectDir,
  changeCurrentSelectDir,
  renamingPathname,
  startRenaming,
  endRenaming,
  preRenamingDirpath,
  changePreRenamingDirpath,
  changeCurrentProjectRoot,
}) => {
  const {
    dirOpen,
    isDropFileSystem,
    updateIsDropFileSystem,
    filepath,
    projectSync,
    reload,
  } = useFileStore((state) => ({
    dirOpen: state.dirOpen,
    updateIsDropFileSystem: state.updateIsDropFileSystem,
    isDropFileSystem: state.isDropFileSystem,
    filepath: state.filepath,
    projectSync: state.projectSync,
    reload: state.repoChanged,
  }));

  const [opened, setOpened] = useState(open);
  const [fileList, setFileList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hovered, setHovered] = useState(false);

  // Multi-select state for Shift+Click
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const { setSelectedFiles } = useFileStore((state) => ({
    setSelectedFiles: state.setSelectedFiles,
  }));
  // Helper to set a range of selected files
  const setSelectedFilesRange = (range) => {
    setSelectedFiles(range);
  };

  useEffect(() => {
      console.log("Effect triggered by:", {
        dirpath,
        root,
        opened,
        touchCounter,
      });

    let unmounted = false;

    const updateChildren = async () => {
      try {
        const fileList = await readFileStats(dirpath);

        if (!unmounted) {
          setFileList(fileList);
          setLoading(false);
        }
      } catch (error) {
        if (!unmounted) {
          setError(error);
          setLoading(false);
        }
      }
    };

    updateChildren();

    return () => {
      unmounted = true;
    };
  }, [dirpath, root, opened, touchCounter]);

  const handleMouseOver = () => setHovered(true);

  const handleMouseLeave = () => setHovered(false);

  const handleClick = (e, dirpath) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading) {
      setOpened(!opened);
      changeCurrentSelectDir(dirpath);
    }
  };

  const handleFileMove = (result) => {
    console.log(result);
    if (result) {
      fileMoved(result);
    }
  };

  const handleDeleteDirectory = useCallback(
    (event, dirpath) => {
      event.stopPropagation();
      if (window.confirm(`Confirm: delete ${dirpath}`)) {
        deleteDirectory({ dirpath });
      }
    },
    [deleteDirectory]
  );

  const relpath = path.relative(root, dirpath);
  const basename = path.basename(relpath);
  const ignoreGit = relpath === ".git" || p_ignoreGit || false;

  const [value, setValue] = useState(path.basename(dirpath));
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current && renamingPathname) {
      renameSection(renamingPathname);
    }
  }, [inputRef.current, renamingPathname]);

  const renameSection = (filepath) => {
    setTimeout(() => {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(0, filepath.length);
    }, 0);
  };

  const handleChange = (event) => {
    setValue(event.target.value);
  };

  const handleBlur = () => {
    // endRenaming();
    handleDirRenameConfirm(value);
  };
  const handleRename = useCallback(async () => {
    if (root == dirpath) {
      const projectInfo = await getProjectInfo(root);
      if (!!projectInfo.isSync) {
        toast.warning(
          "This is a shared collaboration project. Renaming is prohibited"
        );
        return;
      }
    }
    startRenaming({ pathname: dirpath });
  }, [startRenaming, dirpath]);

  const handleKeyDown = (ev) => {
    if (ev.key === "Escape") {
      endRenaming();
      setValue(path.basename(dirpath));
    } else if (ev.key === "Enter") {
      handleDirRenameConfirm(value);
    }
  };

  const handleDirRenameConfirm = async (value) => {
    if (!value || value == "") {
      endRenaming();
      return;
    }
    const parentDir = path.dirname(dirpath);
    const newDirPath = path.join(parentDir, value);
    if (opened) {
      changePreRenamingDirpath({ dirpath: newDirPath });
    }
    try {
      // Rename the directory
      await pify(fs.rename)(dirpath, newDirPath);

      endRenaming();
      setValue(path.basename(newDirPath));
      fileMoved({ fromPath: dirpath, destPath: newDirPath });
      if (depth == 0) {
        changeCurrentProjectRoot({ projectRoot: newDirPath });
      }
    } catch (error) {
      console.error("Error renaming directory:", error);
    }
  };

  //新增 打开文件夹
  useEffect(() => {
    if (!!dirOpen) {
      if (!currentSelectDir) {
        let dir = path.dirname(filepath);
        setOpened(open || dir == dirpath ? true : false);
        return;
      }
      setOpened(open || currentSelectDir == dirpath ? true : false);
    }
  }, [dirOpen]);

  const onAddFile = useCallback(
    (e) => {
      e.stopPropagation();
      setOpened(true);
      startFileCreating(dirpath);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, [0]);
    },
    [startFileCreating, dirpath]
  );

  const onAddFolder = useCallback(
    (e) => {
      e.stopPropagation();
      setOpened(true);
      startDirCreating(dirpath);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, [0]);
    },
    [startDirCreating, dirpath]
  );

  const menuItems = useMemo(() => {
    return [
      {
        label: "Add File",
        command: (e) => {
          setHovered(false);
          onAddFile(e);
        },
        icon: "NewFile",
      },
      {
        label: "Add Folder",
        command: (e) => {
          setHovered(false);
          onAddFolder(e);
        },
        icon: "NewFolder",
      },
      {
        label: "Rename",
        command: async () => {
          setHovered(false);
          handleRename();
        },
        icon: "FileRename",
      },
      depth != 0 && {
        label: "Delete",
        command: (event) => {
          setHovered(false);
          handleDeleteDirectory(event, dirpath);
        },
        icon: "FileDelete",
      },
    ].filter((item) => item?.label);
  }, [
    depth,
    dirpath,
    handleDeleteDirectory,
    handleRename,
    onAddFile,
    onAddFolder,
  ]);

  return (
    <List className="p-0">
      <ContextMenu items={menuItems}>
        <div onMouseOver={handleMouseOver} onMouseLeave={handleMouseLeave}>
          <Draggable
            pathname={dirpath}
            type="dir"
            onDrop={handleFileMove}
            onDropByOther={() => setOpened(true)}
            isEnabled={isDropFileSystem && renamingPathname !== dirpath}
            setHover={() => {
              console.log("setHover");
            }}
            projectSync={projectSync}
            reload={reload}
          >
            <ListItem
              onMouseOver={handleMouseOver}
              onMouseLeave={handleMouseLeave}
              className={`hover:bg-[#bae6bc5c] transition duration-300 ${
                currentSelectDir == dirpath ? "bg-[#81c784]" : ""
              }`}
              style={{
                padding: "3px 0px 3px 0px",
                paddingLeft: `${depth * 8}px`,
              }}
            >
              <ListItemIcon
                style={{
                  minWidth: "unset",
                  // visibility:
                  //   fileList && fileList.length > 0 ? 'visible' : 'hidden' ,
                }}
                onClick={(e) => handleClick(e, dirpath)}
              >
                {opened ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </ListItemIcon>
              <ListItemIcon
                style={{ minWidth: "unset" }}
                onClick={(e) => handleClick(e, dirpath)}
              >
                {opened ? (
                  <ArIcon
                    name={"FolderOpen"}
                    className="text-black w-[1.5rem]"
                  />
                ) : (
                  <ArIcon
                    name={"FolderClose"}
                    className="text-black w-[1.5rem]"
                  />
                )}
              </ListItemIcon>
              {renamingPathname === dirpath ? (
                <TextField
                  className="tailwind-classes-for-input"
                  variant="outlined"
                  size="small"
                  value={value}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  inputRef={inputRef}
                  sx={{
                    "& .MuiInputBase-input": {
                      height: "24px",
                      padding: "0 6px",
                    },
                    "& .MuiOutlinedInput-root": {
                      "& fieldset": {
                        borderColor: "#81C784",
                      },
                      "&:hover fieldset": {
                        borderColor: "#81C784",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "#81C784",
                      },
                    },
                  }}
                />
              ) : (
                <React.Fragment>
                  <div
                    className="w-full"
                    onClick={(e) => handleClick(e, dirpath)}
                  >
                    <Pathname ignoreGit={ignoreGit}>
                      {basename || `${path.basename(dirpath)}`}
                    </Pathname>
                  </div>

                  <HoverMenu
                    basename={basename}
                    dirpath={basename}
                    root={basename}
                    onAddFile={onAddFile}
                    onAddFolder={onAddFolder}
                    onDelete={(event) => {
                      handleDeleteDirectory(event, dirpath);
                    }}
                    onRename={(event) => {
                      handleRename(event);
                    }}
                    depth={depth}
                    menuItems={menuItems}
                    hovered={hovered}
                  />
                </React.Fragment>
              )}
            </ListItem>
          </Draggable>
        </div>
      </ContextMenu>
      {opened && (
        <>
          {isFileCreating == dirpath && (
            <div>
              <AddFile parentDir={dirpath} depth={depth} inputRef={inputRef} />
            </div>
          )}
          {isDirCreating == dirpath && (
            <div>
              <AddDir parentDir={dirpath} depth={depth} inputRef={inputRef} />
            </div>
          )}
        </>
      )}
      {opened && fileList != null && (
        <LinkedLines
          root={root}
          dirpath={dirpath}
          depth={depth + 1}
          fileList={fileList}
          editingFilepath={editingFilepath}
          touchCounter={touchCounter}
          isFileCreating={isFileCreating}
          isDirCreating={isDirCreating}
          fileMoved={fileMoved}
          startFileCreating={startFileCreating}
          startDirCreating={startDirCreating}
          deleteDirectory={deleteDirectory}
          ignoreGit={ignoreGit}
          loadFile={loadFile}
          currentSelectDir={currentSelectDir}
          changeCurrentSelectDir={changeCurrentSelectDir}
          renamingPathname={renamingPathname}
          startRenaming={startRenaming}
          endRenaming={endRenaming}
          preRenamingDirpath={preRenamingDirpath}
          changePreRenamingDirpath={changePreRenamingDirpath}
          changeCurrentProjectRoot={changeCurrentProjectRoot}
          // Multi-select support
          lastSelectedIndex={lastSelectedIndex}
          setLastSelectedIndex={setLastSelectedIndex}
          setSelectedFilesRange={setSelectedFilesRange}
        />
      )}
    </List>
  );
};

const DirectoryLine = (props) => {
  return <DirectoryLineContent {...props} />;
};

export default DirectoryLine;
